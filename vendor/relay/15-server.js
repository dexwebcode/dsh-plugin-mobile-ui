//#region lib/types/server.js
// 15-server.js — слушатели, политики доступа и обслуживание запросов.
/** The primary listener: every credential class, every relay route. */
const PRIMARY_POLICY = (secure) => ({
	secure,
	accepts: new Set([
		"loopback",
		"session",
		"device",
		"address-grant"
	]),
	servesRelayRoutes: true
});
/**
* The plain-HTTP compatibility listener.
*
* It exists for one client — DSH Mobile 0.5.0, which hardcodes `http://` and
* cannot reach a TLS listener at all. It therefore accepts only the credential
* classes that client can actually carry, refuses password sessions (a sign-in
* cookie must never cross an unencrypted hop), and serves no relay routes
* except the liveness probe: pairing happens over the primary listener or on
* loopback, where the minted token is not readable off the wire.
*/
const COMPAT_POLICY = {
	secure: false,
	accepts: new Set([
		"loopback",
		"device",
		"address-grant"
	]),
	servesRelayRoutes: false
};
/** Path prefixes a write method may address without being named in config. */
const WRITE_PREFIXES = ["/api/", "/api?"];
/** Paths a write method may address exactly. */
const WRITE_PATHS = new Set(["/api"]);
/**
* Whether a write request may be proxied at all.
*
* Reads pass freely — that is the single-page application, its bundles, and
* its assets. Writes are scoped, because the harness's Connection carrier lets
* any plugin register an RPC channel of its own under a path this relay has
* never heard of, and several of them are declared loopback-only. Rewriting
* `Host` would promote every such channel to network-reachable; refusing an
* unrecognized write path keeps that promotion to the one channel this relay
* actually reasons about.
* @param pathname - the request pathname.
* @param extra - operator-declared additional prefixes.
* @returns true when the write may proceed.
*/
function writeAllowed(pathname, extra) {
	if (WRITE_PATHS.has(pathname)) return true;
	if (WRITE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
	return extra.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
/** Whether a browser asked for a document, and so should be redirected rather than refused. */
function wantsDocument(req) {
	return (req.headers.accept ?? "").includes("text/html");
}
/** The origin a client used to reach this listener. */
function originOf(req, secure) {
	const host = typeof req.headers.host === "string" ? req.headers.host : "localhost";
	return `${secure ? "https" : "http"}://${host}`;
}
/**
* The plain listener's origin, as this client would reach it.
* @param req - the inbound request, read for the host it addressed.
* @param plainPort - the compatibility listener's port, when one is running.
* @returns the origin, or undefined when no plain listener exists.
*/
function plainOriginOf(req, plainPort) {
	if (plainPort === void 0) return void 0;
	return `http://${(typeof req.headers.host === "string" ? req.headers.host : "localhost").replace(/:\d+$/, "")}:${String(plainPort)}`;
}
/**
* Serve one request, in the order the module comment describes.
* @param req - the inbound request.
* @param res - the response, owned entirely by this call.
* @param runtime - the relay's live state.
* @param policy - what this listener accepts.
* @param authorities - the authorities this relay answers to.
* @returns resolution once the response is finished.
*/
async function serve(req, res, runtime, policy, authorities) {
	const now = Date.now();
	const address = normalizeAddress(req.socket.remoteAddress);
	const local = isLoopbackHostname(address === "" ? "x" : address);
	if ((!local || isForwarded(req.headers)) && runtime.auth.exceedsRate(address, now)) {
		res.writeHead(429, {
			"content-type": "text/plain; charset=utf-8",
			"retry-after": "60"
		});
		res.end("too many requests");
		return;
	}
	const rejection = checkFence({
		headers: req.headers,
		method: req.method,
		directLoopbackPeer: local && !isForwarded(req.headers)
	}, authorities);
	if (rejection !== void 0) {
		const named = rejection === "untrusted-host" ? `${rejection} (Host: ${String(req.headers.host ?? "")}; add it to publicHostnames)` : rejection;
		runtime.log(`refused ${req.method ?? "GET"} ${req.url ?? "/"} from ${address}: ${named}`);
		res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
		res.end("forbidden");
		return;
	}
	let url;
	try {
		url = new URL(req.url ?? "/", "http://relay.invalid");
	} catch {
		res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
		res.end("bad request");
		return;
	}
	const identity = classify(runtime.auth, req, address, local, policy, now);
	if (url.pathname === RELAY_PREFIX || url.pathname.startsWith(`${RELAY_PREFIX}/`)) {
		if (!policy.servesRelayRoutes && url.pathname !== "/relay/health") {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("not found");
			return;
		}
		await handleRelayRoute(req, res, url, {
			auth: runtime.auth,
			config: runtime.config,
			identity,
			address,
			origin: originOf(req, policy.secure),
			plainOrigin: plainOriginOf(req, runtime.plainPort),
			fingerprint: runtime.fingerprint,
			secure: policy.secure,
			now
		});
		return;
	}
	const method = req.method ?? "GET";
	if (!(method === "GET" || method === "HEAD" || method === "OPTIONS") && !writeAllowed(url.pathname, runtime.config.extraProxyPaths)) {
		runtime.log(`refused ${method} ${url.pathname}: not a proxied write path`);
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
		res.end("not found");
		return;
	}
	if (!isAuthenticated(identity)) {
		if (wantsDocument(req) && policy.servesRelayRoutes) {
			sendRedirect(res, `/relay/login?next=${encodeURIComponent(url.pathname + url.search)}`);
			return;
		}
		if ((req.headers.accept ?? "").includes("application/json") || url.pathname.startsWith("/api")) {
			sendJson(res, 403, {
				error: "forbidden",
				message: "pair this device with the relay first"
			});
			return;
		}
		sendHtml(res, 403, messagePage({
			title: "Not signed in",
			message: "Pair this device with the relay, or sign in, before reaching the harness.",
			kind: "error"
		}));
		return;
	}
	if (isPinnedMethod(url.pathname, identity.privileged)) {
		runtime.log(`refused ${url.pathname} for ${identity.credential}: privileged method`);
		sendJson(res, 403, {
			error: "forbidden",
			message: "this method is served only to the machine running the harness"
		});
		return;
	}
	if (identity.deviceId !== void 0) runtime.auth.touch(identity.deviceId, address, now);
	await forward(req, res, runtime.target);
}
/**
* Classify a request under one listener's policy.
* @param auth - the authenticator.
* @param req - the inbound request.
* @param address - normalized source address.
* @param local - whether the peer is loopback.
* @param policy - what this listener accepts.
* @param now - current epoch millis.
* @returns the identity, downgraded to `none` when the listener refuses that class.
*/
function classify(auth, req, address, local, policy, now) {
	const identity = auth.identify({
		headers: req.headers,
		address,
		local
	}, now);
	if (!policy.accepts.has(identity.credential)) return {
		credential: "none",
		privileged: false
	};
	return identity;
}
/**
* Handle one upgrade request.
*
* The mobile client opens both downlinks concurrently and gives them 3000 ms
* together before it abandons the connection generation, so this path does no
* I/O of its own: the fence reads headers, and the credential check is one
* HMAC against in-memory state.
* @param req - the upgrade request.
* @param socket - the client socket.
* @param head - bytes already read past the handshake.
* @param runtime - the relay's live state.
* @param policy - what this listener accepts.
* @param authorities - the authorities this relay answers to.
* @param ledger - registry the established sockets join.
*/
function serveUpgrade(req, socket, head, runtime, policy, authorities, ledger) {
	const now = Date.now();
	const address = normalizeAddress(req.socket.remoteAddress);
	const local = isLoopbackHostname(address === "" ? "x" : address);
	if (checkFence({
		headers: req.headers,
		method: req.method,
		directLoopbackPeer: local && !isForwarded(req.headers)
	}, authorities) !== void 0) {
		rejectUpgrade(socket, 403, "Forbidden");
		return;
	}
	const identity = classify(runtime.auth, req, address, local, policy, now);
	if (!isAuthenticated(identity)) {
		rejectUpgrade(socket, 403, "Forbidden");
		return;
	}
	if (identity.deviceId !== void 0) runtime.auth.touch(identity.deviceId, address, now);
	forwardUpgrade(req, socket, head, runtime.target, ledger);
}
/**
* Start one listener.
* @param options.runtime - the relay's live state.
* @param options.bind - listen address.
* @param options.port - listen port; zero requests an OS-assigned port.
* @param options.tls - certificate material, or undefined for plaintext.
* @param options.compat - run under the compatibility policy rather than the primary one.
* @param options.authorities - the authorities this relay answers to.
* @returns the running listener.
*/
async function startListener(options) {
	const policy = options.compat === true ? COMPAT_POLICY : PRIMARY_POLICY(options.tls !== void 0);
	const ledger = new SocketLedger();
	const handler = (req, res) => {
		serve(req, res, options.runtime, policy, options.authorities).catch((error) => {
			options.runtime.log(`request failed: ${String(error)}`);
			if (!res.headersSent) {
				res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
				res.end("internal error");
			} else res.destroy();
		});
	};
	const server = options.tls === void 0 ? createServer(handler) : createServer$1({
		cert: options.tls.cert,
		key: options.tls.key,
		minVersion: "TLSv1.2"
	}, handler);
	server.on("upgrade", (req, socket, head) => {
		serveUpgrade(req, socket, head, options.runtime, policy, options.authorities, ledger);
	});
	server.setTimeout(12e4);
	await new Promise((resolve$1, reject) => {
		server.once("error", reject);
		server.listen(options.port, options.bind, () => {
			server.removeListener("error", reject);
			resolve$1();
		});
	});
	const bound = server.address();
	return {
		port: typeof bound === "object" && bound !== null ? bound.port : options.port,
		close: async () => {
			ledger.destroyAll();
			server.closeAllConnections();
			await new Promise((resolve$1) => {
				server.close(() => {
					resolve$1();
				});
			});
		}
	};
}

//#endregion
