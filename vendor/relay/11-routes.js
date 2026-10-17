//#region lib/types/routes.js
// 11-routes.js — обработчик путей /relay/*.
/** Prefix owning every route in this module. */
const RELAY_PREFIX = "/relay";
/** Whether this identity may issue invitations and manage devices. */
function isOperator(identity) {
	return identity.credential === "loopback" || identity.credential === "session";
}
/** Whether this identity may see the harness at all. */
function isAuthenticated(identity) {
	return identity.credential !== "none";
}
/**
* Refuse a request, in whichever representation the caller asked for.
* @param req - the inbound request, read for its Accept header.
* @param res - the response to write.
* @param message - the reason, safe to show a client.
*/
function refuse(req, res, message) {
	if (wantsJson(req)) {
		sendJson(res, 403, {
			error: "forbidden",
			message
		});
		return;
	}
	sendHtml(res, 403, messagePage({
		title: "Not allowed",
		message,
		kind: "error"
	}));
}
/**
* Render the QR carrying an invitation.
* @param context - the relay's origins and certificate identity.
* @param code - the live invitation.
* @returns the QR as inline SVG.
*/
async function renderQr(context, code) {
	const payload = pairingPayload({
		url: context.origin,
		plainUrl: context.plainOrigin,
		fingerprint: context.fingerprint,
		code
	});
	return QRCode.toString(JSON.stringify(payload), {
		type: "svg",
		margin: 0,
		errorCorrectionLevel: "M",
		color: {
			dark: "#0f1115",
			light: "#ffffff"
		}
	});
}
/**
* Handle one `/relay` request.
* @param req - the inbound request.
* @param res - the response, owned entirely by this call.
* @param url - the parsed request URL.
* @param context - the relay's live state for this request.
* @returns resolution once the response is finished.
*/
async function handleRelayRoute(req, res, url, context) {
	const { auth, config, identity, now } = context;
	const path = url.pathname;
	const method = req.method ?? "GET";
	if (path === "/relay/health" && (method === "GET" || method === "HEAD")) {
		sendJson(res, 200, {
			service: "dsh-relay",
			ok: true
		});
		return;
	}
	if (path === "/relay/login" && method === "GET") {
		if (!auth.hasPassword && isOperator(identity)) {
			sendRedirect(res, "/relay/password");
			return;
		}
		if (isAuthenticated(identity)) {
			sendRedirect(res, safeNextPath(url.searchParams.get("next")));
			return;
		}
		if (!auth.hasPassword) {
			refuse(req, res, "No password is set yet. Set one from the machine running the harness first.");
			return;
		}
		sendHtml(res, 200, loginPage({ next: safeNextPath(url.searchParams.get("next")) }));
		return;
	}
	if (path === "/relay/password" && method === "GET") {
		if (auth.hasPassword ? !isOperator(identity) : identity.credential !== "loopback") {
			refuse(req, res, "Set the password from the machine running the harness.");
			return;
		}
		sendHtml(res, 200, passwordPage({
			hasPassword: auth.hasPassword,
			next: safeNextPath(url.searchParams.get("next"))
		}));
		return;
	}
	if (path === "/relay/password" && method === "POST") {
		if (auth.hasPassword ? !isOperator(identity) : identity.credential !== "loopback") {
			refuse(req, res, "Set the password from the machine running the harness.");
			return;
		}
		const body = await readBody(req);
		if (body === void 0) {
			refuse(req, res, "Request too large.");
			return;
		}
		const fields = parseFields(req, body);
		const password = fields.password ?? "";
		const next = safeNextPath(fields.next ?? "/relay/devices");
		const reject = (message) => {
			sendHtml(res, 400, passwordPage({
				hasPassword: auth.hasPassword,
				error: message,
				next
			}));
		};
		if (password.length < 10) {
			reject("Use at least 10 characters.");
			return;
		}
		if (fields.confirm !== void 0 && fields.confirm !== password) {
			reject("The two passwords do not match.");
			return;
		}
		await auth.setPassword(password);
		if (wantsJson(req)) {
			sendJson(res, 200, { ok: true });
			return;
		}
		sendRedirect(res, next);
		return;
	}
	if (path === "/relay/login" && method === "POST") {
		const body = await readBody(req);
		if (body === void 0) {
			refuse(req, res, "Request too large.");
			return;
		}
		const fields = parseFields(req, body);
		const next = safeNextPath(fields.next ?? "/");
		const outcome = await auth.signIn(fields.password ?? "", context.address, now);
		if (outcome === "no-password") {
			refuse(req, res, "No password is set yet.");
			return;
		}
		if (outcome === "locked-out") {
			sendHtml(res, 429, loginPage({
				error: "Too many attempts. Try again later.",
				next
			}), { "retry-after": String(Math.ceil(config.lockoutMs / 1e3)) });
			return;
		}
		if (outcome === "bad-password") {
			sendHtml(res, 403, loginPage({
				error: "That password did not match.",
				next
			}));
			return;
		}
		const cookie = sessionCookie({
			name: SESSION_COOKIE,
			value: outcome.cookie,
			maxAgeSeconds: Math.floor(config.sessionTtlMs / 1e3),
			secure: context.secure
		});
		if (wantsJson(req)) {
			sendJson(res, 200, { expiresAt: outcome.expiresAt }, { "set-cookie": cookie });
			return;
		}
		sendRedirect(res, next, { "set-cookie": cookie });
		return;
	}
	if (path === "/relay/logout" && method === "POST") {
		const cookie = sessionCookie({
			name: SESSION_COOKIE,
			value: "",
			maxAgeSeconds: 0,
			secure: context.secure
		});
		sendRedirect(res, "/relay/login", { "set-cookie": cookie });
		return;
	}
	if (path === "/relay/pair/new" && method === "POST") {
		if (!isOperator(identity)) {
			refuse(req, res, "Pairing codes are issued from the machine running the harness.");
			return;
		}
		auth.pairing.issue(config.pairingCodeLength, config.pairingWindowMs, now);
		sendRedirect(res, "/relay/pair");
		return;
	}
	if (path === "/relay/pair.json" && method === "GET") {
		if (!isOperator(identity)) {
			refuse(req, res, "Pairing codes are issued from the machine running the harness.");
			return;
		}
		const invitation = auth.pairing.peek(now) ?? auth.pairing.issue(config.pairingCodeLength, config.pairingWindowMs, now);
		sendJson(res, 200, {
			code: invitation.code,
			expiresAt: invitation.expiresAt,
			expiresInSeconds: Math.max(0, Math.round((invitation.expiresAt - now) / 1e3)),
			qrSvg: await renderQr(context, invitation),
			url: context.origin,
			...context.plainOrigin === void 0 ? {} : { plainUrl: context.plainOrigin },
			...context.fingerprint === void 0 ? {} : { fingerprint: context.fingerprint }
		});
		return;
	}
	if (path === "/relay/pair" && method === "GET") {
		if (isOperator(identity)) {
			const code = auth.pairing.peek(now) ?? auth.pairing.issue(config.pairingCodeLength, config.pairingWindowMs, now);
			sendHtml(res, 200, pairPage({
				qrSvg: await renderQr(context, code),
				code: code.code,
				expiresInSeconds: Math.max(0, Math.round((code.expiresAt - now) / 1e3)),
				url: context.origin,
				plainUrl: context.plainOrigin,
				fingerprint: context.fingerprint
			}));
			return;
		}
		sendHtml(res, 200, claimPage({ code: url.searchParams.get("code") ?? void 0 }));
		return;
	}
	if (path === "/relay/pair" && method === "POST") {
		const body = await readBody(req);
		if (body === void 0) {
			refuse(req, res, "Request too large.");
			return;
		}
		const fields = parseFields(req, body);
		const paired = await auth.pair({
			code: fields.code ?? "",
			name: fields.name ?? fields.deviceName ?? "device",
			address: context.address
		}, now);
		if (paired === "locked-out") {
			const until = auth.lockedUntil(context.address, now) ?? now + config.lockoutMs;
			const retryAfter = String(Math.max(1, Math.ceil((until - now) / 1e3)));
			if (wantsJson(req)) {
				sendJson(res, 429, {
					error: "rate-limited",
					message: "Too many attempts. Try again later."
				}, { "retry-after": retryAfter });
				return;
			}
			sendHtml(res, 429, claimPage({ error: "Too many attempts from this device. Try again later." }), { "retry-after": retryAfter });
			return;
		}
		if (paired === void 0) {
			if (wantsJson(req)) {
				sendJson(res, 403, {
					error: "pairing-failed",
					message: "That code is not valid."
				});
				return;
			}
			sendHtml(res, 403, claimPage({ error: "That code is not valid, has expired, or was already used." }));
			return;
		}
		const granted = context.config.compat.addressGrants && auth.identify({
			headers: {},
			address: context.address,
			local: false
		}, now).credential === "address-grant";
		if (wantsJson(req)) {
			sendJson(res, 200, {
				deviceId: paired.device.id,
				token: paired.token,
				expiresAt: paired.device.expiresAt,
				...context.fingerprint !== void 0 && { fingerprint: context.fingerprint }
			});
			return;
		}
		const cookie = sessionCookie({
			name: SESSION_COOKIE,
			value: "",
			maxAgeSeconds: 0,
			secure: context.secure
		});
		sendHtml(res, 200, pairedPage({
			deviceName: paired.device.name,
			token: paired.token,
			granted,
			plainUrl: context.plainOrigin
		}), { "set-cookie": cookie });
		return;
	}
	if (path === "/relay/devices" && method === "GET") {
		if (!isOperator(identity)) {
			refuse(req, res, "Sign in to manage devices.");
			return;
		}
		sendHtml(res, 200, devicesPage({
			devices: auth.devices,
			now,
			tlsMode: config.tls,
			hasPassword: auth.hasPassword,
			fingerprint: context.fingerprint,
			url: context.origin,
			plainUrl: context.plainOrigin
		}));
		return;
	}
	if (path === "/relay/devices/revoke" && method === "POST") {
		if (!isOperator(identity)) {
			refuse(req, res, "Sign in to manage devices.");
			return;
		}
		const body = await readBody(req);
		if (body === void 0) {
			refuse(req, res, "Request too large.");
			return;
		}
		const fields = parseFields(req, body);
		await auth.revoke(fields.deviceId ?? "", now);
		sendRedirect(res, "/relay/devices");
		return;
	}
	if (path === "/relay/signout-everywhere" && method === "POST") {
		if (!isOperator(identity)) {
			refuse(req, res, "Sign in to manage devices.");
			return;
		}
		await auth.signOutEverywhere();
		const cookie = sessionCookie({
			name: SESSION_COOKIE,
			value: "",
			maxAgeSeconds: 0,
			secure: context.secure
		});
		sendRedirect(res, "/relay/login", { "set-cookie": cookie });
		return;
	}
	if (wantsJson(req)) {
		sendJson(res, 404, { error: "not-found" });
		return;
	}
	sendHtml(res, 404, messagePage({
		title: "Not found",
		message: "No such relay endpoint.",
		kind: "error"
	}));
}

//#endregion
