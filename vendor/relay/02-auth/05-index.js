//#region lib/types/auth/index.js
// 05-index.js — хранилище доступа: вход, устройства, выдачи адресам.
/** Name of the signed sign-in cookie. */
const SESSION_COOKIE = "dsh_relay_session";
/**
* Headers a forwarding proxy stamps on the traffic it relays.
*
* Funnel, Serve, and Caddy always add `X-Forwarded-For`; nginx does in any
* configuration written from its own documentation. A browser never sends any
* of these on its own, so a false positive costs one sign-in, while a false
* negative seats the internet in the operator's chair.
*/
const FORWARDING_TELLS = [
	"forwarded",
	"x-forwarded-for",
	"x-forwarded-host",
	"x-forwarded-proto",
	"x-real-ip",
	"via"
];
/**
* Whether a request visibly came through a forwarding proxy.
* @param headers - the inbound request headers.
* @returns true when any forwarding header is present.
*/
function isForwarded(headers) {
	return FORWARDING_TELLS.some((name$1) => headers[name$1] !== void 0);
}
/**
* The relay's authentication state.
*
* Owns the in-memory token index, the pairing window, and the throttles; the
* durable half lives in {@link RelayStore}.
*/
var Authenticator = class {
	store;
	config;
	/** token hash → device id, rebuilt from the store on construction and on every mutation. */
	#tokenIndex = /* @__PURE__ */ new Map();
	#throttle;
	pairing = new PairingWindow();
	/**
	* @param store - the durable state store.
	* @param config - resolved plugin configuration.
	*/
	constructor(store, config) {
		this.store = store;
		this.config = config;
		this.#throttle = new Throttle({
			requestsPerMinute: config.rateLimitPerMinute,
			maxFailures: config.maxFailedAttempts,
			lockoutMs: config.lockoutMs
		});
		this.#reindex();
	}
	/** Rebuild the token lookup index from durable state. */
	#reindex() {
		const index = /* @__PURE__ */ new Map();
		for (const device of Object.values(this.store.state.devices)) {
			if (device.revokedAt !== void 0) continue;
			index.set(device.tokenHash, device.id);
		}
		this.#tokenIndex = index;
	}
	/** Whether a password has been set at all. */
	get hasPassword() {
		return this.store.state.password !== void 0;
	}
	/** Live, unrevoked devices, newest first. */
	get devices() {
		return Object.values(this.store.state.devices).filter((device) => device.revokedAt === void 0).toSorted((a, b) => b.createdAt - a.createdAt);
	}
	/**
	* Record one request against the per-address rate limit.
	* @param address - normalized source address.
	* @param now - current epoch millis.
	* @returns true when the request is over the limit and must be refused.
	*/
	exceedsRate(address, now) {
		return this.#throttle.exceedsRate(address, now);
	}
	/**
	* When an address's lockout expires, or undefined when it is not locked out.
	* @param address - the normalized source address.
	* @param now - current epoch millis.
	* @returns epoch millis the lockout lifts.
	*/
	lockedUntil(address, now) {
		return this.#throttle.lockedUntil(address, now);
	}
	/**
	* Classify one request.
	* @param request - the request's headers, source address, and locality.
	* @param now - current epoch millis.
	* @returns the credential class and what it entitles the caller to.
	*/
	identify(request$1, now) {
		const allowPrivileged = this.config.privilegedMethods === "allow-authenticated";
		if (request$1.local && !isForwarded(request$1.headers)) return {
			credential: "loopback",
			privileged: true
		};
		const bearer = readBearer(request$1.headers.authorization);
		if (bearer !== void 0) {
			const device = this.#deviceForToken(bearer, now);
			if (device !== void 0) return {
				credential: "device",
				deviceId: device.id,
				privileged: allowPrivileged
			};
		}
		const cookie = readCookie(request$1.headers.cookie, SESSION_COOKIE);
		if (cookie !== void 0) {
			const claims = verifySession(this.store.state.signingKey, cookie, now);
			if (claims !== void 0) return {
				credential: "session",
				...claims.subject !== "password" && { deviceId: claims.subject },
				privileged: allowPrivileged
			};
		}
		if (this.config.compat.addressGrants) {
			const grant = this.store.state.grants[request$1.address];
			if (grant !== void 0 && now < grant.expiresAt && now >= grant.createdAt) {
				const device = this.store.state.devices[grant.deviceId];
				if (device !== void 0 && device.revokedAt === void 0) return {
					credential: "address-grant",
					deviceId: grant.deviceId,
					privileged: false
				};
			}
		}
		return {
			credential: "none",
			privileged: false
		};
	}
	/**
	* Resolve a bearer token to its device.
	* @param token - the token as presented.
	* @param now - current epoch millis.
	* @returns the device, or undefined when the token is unknown, revoked, or expired.
	*/
	#deviceForToken(token, now) {
		const deviceId = this.#tokenIndex.get(hashToken(this.store.state.signingKey, token));
		if (deviceId === void 0) return void 0;
		const device = this.store.state.devices[deviceId];
		if (device === void 0 || device.revokedAt !== void 0) return void 0;
		if (now >= device.expiresAt || now < device.createdAt) return void 0;
		return device;
	}
	/**
	* Set or replace the sign-in password.
	* @param password - the new plaintext.
	* @returns resolution once the hash is durable.
	*/
	async setPassword(password) {
		const record = await hashPassword(password);
		await this.store.update((draft) => {
			draft.password = record;
		});
	}
	/**
	* Verify a sign-in and mint a session cookie.
	* @param password - the plaintext as typed.
	* @param address - normalized source address, for the lockout counter.
	* @param now - current epoch millis.
	* @returns the cookie to set, or the reason the attempt was refused.
	*/
	async signIn(password, address, now) {
		const record = this.store.state.password;
		if (record === void 0) return "no-password";
		if (this.#throttle.lockedUntil(address, now) !== void 0) return "locked-out";
		if (!await verifyPassword(record, password)) {
			this.#throttle.recordFailure(address, now);
			return "bad-password";
		}
		this.#throttle.recordSuccess(address);
		const expiresAt = now + this.config.sessionTtlMs;
		return {
			cookie: signSession(this.store.state.signingKey, {
				subject: "password",
				issuedAt: now,
				expiresAt
			}),
			expiresAt
		};
	}
	/**
	* Enrol a device against the outstanding pairing code.
	* @param options.code - the code as presented.
	* @param options.name - the device label to record.
	* @param options.address - normalized source address.
	* @param now - current epoch millis.
	* @returns the minted token and its device, or undefined when the code did not match.
	*/
	async pair(options, now) {
		if (this.#throttle.lockedUntil(options.address, now) !== void 0) return "locked-out";
		if (!this.pairing.claim(options.code, now)) {
			this.#throttle.recordFailure(options.address, now);
			return;
		}
		this.#throttle.recordSuccess(options.address);
		const token = mintToken();
		const device = {
			id: mintDeviceId(),
			name: options.name.slice(0, 64) || "device",
			tokenHash: hashToken(this.store.state.signingKey, token),
			createdAt: now,
			expiresAt: now + this.config.deviceTokenTtlMs,
			lastAddress: options.address
		};
		await this.store.update((draft) => {
			draft.devices[device.id] = device;
			if (this.config.compat.addressGrants && isPrivateAddress(options.address)) draft.grants[options.address] = {
				address: options.address,
				deviceId: device.id,
				createdAt: now,
				expiresAt: now + this.config.compat.addressGrantTtlMs
			};
		});
		this.#reindex();
		return {
			token,
			device
		};
	}
	/**
	* Refresh a device's grant after an accepted request from a new address.
	* @param deviceId - the device.
	* @param address - normalized source address.
	* @param now - current epoch millis.
	* @returns resolution once the record is durable.
	*/
	async touch(deviceId, address, now) {
		const device = this.store.state.devices[deviceId];
		if (device === void 0) return;
		if (device.lastAddress === address && (device.lastSeenAt ?? 0) > now - 6e4) return;
		await this.store.update((draft) => {
			const record = draft.devices[deviceId];
			if (record === void 0) return;
			record.lastSeenAt = now;
			record.lastAddress = address;
			if (this.config.compat.addressGrants && isPrivateAddress(address)) draft.grants[address] = {
				address,
				deviceId,
				createdAt: now,
				expiresAt: now + this.config.compat.addressGrantTtlMs
			};
		});
	}
	/**
	* Revoke one device and every grant it created.
	* @param deviceId - the device to revoke.
	* @param now - current epoch millis.
	* @returns true when a live device was revoked.
	*/
	async revoke(deviceId, now) {
		const device = this.store.state.devices[deviceId];
		if (device === void 0 || device.revokedAt !== void 0) return false;
		await this.store.update((draft) => {
			const record = draft.devices[deviceId];
			if (record !== void 0) record.revokedAt = now;
			for (const [address, grant] of Object.entries(draft.grants)) if (grant.deviceId === deviceId) delete draft.grants[address];
		});
		this.#reindex();
		return true;
	}
	/**
	* Rotate the signing key, invalidating every cookie and every device token.
	*
	* Device records are dropped rather than kept with dead hashes: a token hash
	* is keyed by the signing key, so after rotation none of them could ever
	* match again and leaving them would only misreport what is enrolled.
	* @returns resolution once the new key is durable.
	*/
	async signOutEverywhere() {
		const { randomBytes: randomBytes$1 } = await import("node:crypto");
		await this.store.update((draft) => {
			draft.signingKey = randomBytes$1(32).toString("base64url");
			draft.devices = {};
			draft.grants = {};
		});
		this.#reindex();
		this.pairing.clear();
	}
	/** Stop the throttle sweep. */
	dispose() {
		this.#throttle.dispose();
		this.pairing.clear();
	}
};

//#endregion
