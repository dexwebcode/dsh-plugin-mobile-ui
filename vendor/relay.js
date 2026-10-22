// 00-header.js — шапка вендора: что это за копия и чем она отличается от источника.
// relay.js — ВЕНДОР dsh-relay 0.3.0 (host-половина), только чтение.
// Копия собранного пакета, чтобы не требовать установки dsh-relay. Ссылка на
// sourcemap срезана: рядом её нет. Зависимости @deepseek-ai/schemastery и qrcode
// объявлены в package.json этого пакета. Браузерная половина relay НЕ вендрится:
// harness допускает один браузерный модуль на пакет, а он занят мобильным слоем.
// Страницы входа и спаривания relay отдаёт сам, с host-половины.
//
// ЕДИНСТВЕННАЯ ПРАВКА против источника — маршрут `GET /relay/pair.json` (см.
// обработчик ниже): он отдаёт то же приглашение, что и страница `/relay/pair`,
// но данными. Раздел «Mobile UI» в настройках harness показывает QR и код у себя,
// а приглашение живёт в памяти relay и больше нигде не доступно.
import { homedir, hostname, networkInterfaces } from "node:os";
import { X509Certificate, createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import z from "@deepseek-ai/schemastery";
import { join, resolve } from "node:path";
import QRCode from "qrcode";
import { createServer, request } from "node:http";
import { createServer as createServer$1 } from "node:https";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { brotliCompress, constants as zlibConstants, gunzip } from "node:zlib";

//#region lib/types/fence.js
// 01-fence.js — кому relay вообще отвечает: проверка authority и Host.
/**
* The address an Android emulator reaches its host machine by.
*
* `10.0.2.2` is a fixed alias inside the emulator's private network, NAT'd to
* the host's loopback — so a request carrying it as `Host` and arriving on a
* loopback socket can only be the emulator on this machine. It is not an
* address the relay can discover: it never appears on any interface here, and
* `localAddresses()` cannot report it.
*
* Trusting it is narrower than it looks, and does not weaken the rebinding
* defence. That attack needs a browser to resolve an attacker's name to a
* local address and send the attacker's name as `Host`; to be refused here a
* page would have to send `Host: 10.0.2.2`, which requires the browser to be
* fetching `http://10.0.2.2:<port>` — an address that does not reach this
* relay from an ordinary machine. The exemption is gated on a direct loopback
* peer besides, so a forwarded request never receives it.
*/
const EMULATOR_HOST_ALIAS = "10.0.2.2";
/**
* Read one header as a single string.
* @param headers - the request's header map.
* @param name - lowercase header name.
* @returns the value, or undefined when absent or repeated.
*/
function header(headers, name$1) {
	const value = headers[name$1];
	return typeof value === "string" ? value : void 0;
}
/**
* Parse a bare `host` or `host:port` authority through WHATWG normalization.
* @param authority - the raw authority.
* @returns the normalized URL, or undefined when it does not parse.
*/
function parseAuthority(authority) {
	try {
		return new URL(`http://${authority}`);
	} catch {
		return;
	}
}
/**
* Canonical form of a parsed authority: `hostname`, or `hostname:port` when a
* port was written. The port is judged from parses under both special schemes,
* never from the raw string, so `:80` and `:443` still count as explicit.
* @param authority - the raw authority, as written.
* @param parsed - the same authority parsed under `http:`.
* @returns the canonical authority.
*/
function canonicalAuthority(authority, parsed) {
	const port = parsed.port !== "" ? parsed.port : new URL(`https://${authority}`).port;
	return port === "" ? parsed.hostname : `${parsed.hostname}:${port}`;
}
/**
* Whether a normalized hostname names the local loopback authority.
* @param hostname - WHATWG URL hostname; IPv6 literals retain their brackets.
* @returns true for localhost, IPv6 loopback, or any IPv4 address in 127/8.
*/
function isLoopbackHostname(hostname$1) {
	if (hostname$1 === "localhost" || hostname$1 === "[::1]") return true;
	const parts = hostname$1.split(".");
	return parts.length === 4 && parts[0] === "127" && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}
/**
* Whether an address is in a private, link-local, or loopback range.
*
* Address grants are refused outside these ranges: a public address is shared
* by everyone behind the same carrier NAT, so granting one would admit
* strangers along with the operator's phone.
* @param address - a bare IPv4 or IPv6 address, brackets optional.
* @returns true when the address is private, link-local, or loopback.
*/
function isPrivateAddress(address) {
	const bare = address.replace(/^\[/, "").replace(/\]$/, "").replace(/^::ffff:/i, "");
	if (bare === "::1") return true;
	const lower = bare.toLowerCase();
	if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80")) return true;
	const octets = bare.split(".");
	if (octets.length !== 4) return false;
	if (!octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return false;
	const a = Number(octets[0]);
	const b = Number(octets[1]);
	if (a === 10 || a === 127) return true;
	if (a === 172 && b >= 16 && b <= 31) return true;
	if (a === 192 && b === 168) return true;
	if (a === 169 && b === 254) return true;
	return false;
}
/**
* Refuse a configured authority that is not already canonical.
*
* Anything WHATWG parsing would silently rewrite is a typo that must fail the
* load rather than quietly widening or narrowing the grant: URL parts beyond
* the authority, a dangling colon, a zero-padded port, or a non-canonical host
* spelling.
* @param entry - the configured value, verbatim.
* @throws {Error} naming the offending entry.
*/
function assertTrustedAuthority(entry) {
	const parsed = parseAuthority(entry);
	if (parsed !== void 0 && canonicalAuthority(entry, parsed) === entry.toLowerCase()) return;
	throw new Error(`dsh-relay: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`);
}
/**
* The IPv4 literals this machine is reachable at on its own networks.
* @returns non-internal IPv4 addresses, in interface order.
*/
function localAddresses() {
	const addresses = [];
	for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
	return addresses;
}
/**
* The authorities this relay answers to.
* @param options.trustedHosts - operator-declared authorities, already validated.
* @param options.publicHostnames - names a port-forwarded deployment is reached by.
* @returns port-less authorities plus loopback, deduplicated.
*/
function relayAuthorities(options) {
	return [...new Set([
		"127.0.0.1",
		"localhost",
		...localAddresses(),
		...options.publicHostnames,
		...options.trustedHosts
	])];
}
/**
* Whether the request authority matches one declared authority. An entry with
* an explicit port matches that exact authority; a port-less entry matches the
* hostname on any port, which is the shape a bind-derived IP literal takes
* when the listen port is OS-assigned.
* @param hostUrl - the parsed request authority.
* @param authorities - the declared authorities.
* @returns true on a match.
*/
function matchesAuthority(hostUrl, authorities) {
	return authorities.some((entry) => {
		const parsed = parseAuthority(entry);
		if (parsed === void 0) return false;
		return canonicalAuthority(entry, parsed) === parsed.hostname ? parsed.hostname === hostUrl.hostname : parsed.host === hostUrl.host;
	});
}
/**
* Whether this is a browser navigating to a page, rather than fetching data.
*
* `navigate` mode with a `document` destination is the shape of a person
* arriving; restricting it to GET and HEAD keeps a cross-site form post — the
* actual request-forgery vector, which shares that mode and destination —
* on the refused side.
* @param request - the inbound request's method and headers.
* @returns true when the request is a safe top-level navigation.
*/
function isReadNavigation(request$1) {
	const method = (request$1.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD") return false;
	if (header(request$1.headers, "sec-fetch-mode") !== "navigate") return false;
	const destination = header(request$1.headers, "sec-fetch-dest");
	return destination === void 0 || destination === "document";
}
/**
* Decide whether one request may reach the relay's routes or its proxy.
* @param request - the inbound request's headers, and whether its peer is
*   directly this machine.
* @param authorities - the authorities this relay answers to.
* @returns the rejection reason, or undefined when the request passes.
*/
function checkFence(request$1, authorities) {
	const host = header(request$1.headers, "host");
	if (host === void 0) return "missing-host";
	const hostUrl = parseAuthority(host);
	if (hostUrl === void 0) return "unparsable-host";
	if (!isLoopbackHostname(hostUrl.hostname) && !(request$1.directLoopbackPeer === true && hostUrl.hostname === EMULATOR_HOST_ALIAS) && !matchesAuthority(hostUrl, authorities)) return "untrusted-host";
	if (header(request$1.headers, "sec-fetch-site") === "cross-site" && !isReadNavigation(request$1)) return "cross-site";
	const origin = header(request$1.headers, "origin");
	if (origin === void 0) return void 0;
	if (origin === "null") return "opaque-origin";
	try {
		return new URL(origin).host === hostUrl.host ? void 0 : "origin-mismatch";
	} catch {
		return "origin-mismatch";
	}
}

//#endregion
//#region lib/types/auth/password.js
// 01-password.js — хеширование и проверка пароля через scrypt.
const scryptAsync = promisify(scrypt);
/**
* scrypt work factor. Raising it later stays verifiable because each record
* carries the cost it was written with.
*/
const DEFAULT_COST = 16384;
/** scrypt block size. */
const BLOCK_SIZE = 8;
/** scrypt parallelization. */
const PARALLELISM = 1;
/** Derived key length in bytes. */
const KEY_LENGTH = 64;
/** Bytes of salt per record. */
const SALT_BYTES = 16;
/**
* Node's default maxmem (32 MiB) is below what N=16384, r=8 needs; state the
* requirement rather than lowering the work factor to fit the default.
* @param cost - the scrypt N parameter.
* @returns the memory ceiling to pass to scrypt.
*/
function maxmemFor(cost) {
	return 256 * cost * BLOCK_SIZE * 2;
}
/**
* Hash a password for storage.
* @param password - the plaintext, as typed.
* @returns the record to persist; the plaintext is never retained.
*/
async function hashPassword(password) {
	const salt = randomBytes(SALT_BYTES);
	const derived = await scryptAsync(password.normalize("NFKC"), salt, KEY_LENGTH, {
		N: DEFAULT_COST,
		r: BLOCK_SIZE,
		p: PARALLELISM,
		maxmem: maxmemFor(DEFAULT_COST)
	});
	return {
		salt: salt.toString("hex"),
		hash: derived.toString("hex"),
		cost: DEFAULT_COST,
		updatedAt: Date.now()
	};
}
/**
* Verify a candidate password against a stored record.
* @param record - the stored credential.
* @param candidate - the plaintext to check.
* @returns true on a match; comparison is constant time in the hash length.
*/
async function verifyPassword(record, candidate) {
	const expected = Buffer.from(record.hash, "hex");
	const derived = await scryptAsync(candidate.normalize("NFKC"), Buffer.from(record.salt, "hex"), expected.length, {
		N: record.cost,
		r: BLOCK_SIZE,
		p: PARALLELISM,
		maxmem: maxmemFor(record.cost)
	});
	return derived.length === expected.length && timingSafeEqual(derived, expected);
}

//#endregion
//#region lib/types/auth/tokens.js
// 02-tokens.js — токены устройств, подпись и разбор сессий.
/** Bytes of entropy in a device bearer token. */
const TOKEN_BYTES = 32;
/** Bytes of entropy in a device id. */
const DEVICE_ID_BYTES = 8;
/**
* Compare two strings without leaking their difference through timing.
* @param a - first value.
* @param b - second value.
* @returns true when the values are byte-identical.
*/
function constantTimeEqual(a, b) {
	const left = Buffer.from(a, "utf8");
	const right = Buffer.from(b, "utf8");
	if (left.length !== right.length) return false;
	return timingSafeEqual(left, right);
}
/**
* Mint a new bearer token.
* @returns a URL-safe token; only its hash is ever stored.
*/
function mintToken() {
	return randomBytes(TOKEN_BYTES).toString("base64url");
}
/**
* Mint a new device id.
* @returns a short opaque id, also the revocation handle.
*/
function mintDeviceId() {
	return randomBytes(DEVICE_ID_BYTES).toString("hex");
}
/**
* Hash a bearer token for storage and for the in-memory lookup index.
* @param signingKey - the relay's current signing key.
* @param token - the bearer token as presented.
* @returns the keyed hash, hex.
*/
function hashToken(signingKey, token) {
	return createHmac("sha256", signingKey).update(token).digest("hex");
}
/**
* Sign a set of session claims into a cookie value.
* @param signingKey - the relay's current signing key.
* @param claims - the claims to carry.
* @returns `<payload>.<signature>`, both base64url.
*/
function signSession(signingKey, claims) {
	const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
	return `${payload}.${createHmac("sha256", signingKey).update(payload).digest("base64url")}`;
}
/**
* Verify a cookie value and return its claims.
*
* A clock step backwards — suspend and resume, an NTP correction — would
* otherwise make a long-lived cookie appear freshly issued or instantly
* expired, so a cookie claiming to be issued in the future is refused rather
* than trusted.
* @param signingKey - the relay's current signing key.
* @param value - the cookie value as presented.
* @param now - current epoch millis.
* @returns the claims, or undefined when the value is forged, malformed, or expired.
*/
function verifySession(signingKey, value, now) {
	const separator = value.lastIndexOf(".");
	if (separator <= 0) return void 0;
	const payload = value.slice(0, separator);
	if (!constantTimeEqual(value.slice(separator + 1), createHmac("sha256", signingKey).update(payload).digest("base64url"))) return void 0;
	let claims;
	try {
		claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
	} catch {
		return;
	}
	if (typeof claims.subject !== "string") return void 0;
	if (typeof claims.issuedAt !== "number" || typeof claims.expiresAt !== "number") return void 0;
	if (now >= claims.expiresAt) return void 0;
	if (now < claims.issuedAt) return void 0;
	return claims;
}
/**
* Read one cookie out of a request's `Cookie` header.
* @param header - the raw header value, or undefined.
* @param name - the cookie name.
* @returns the decoded value, or undefined when absent.
*/
function readCookie(header$1, name$1) {
	if (header$1 === void 0) return void 0;
	for (const part of header$1.split(";")) {
		const separator = part.indexOf("=");
		if (separator < 0) continue;
		if (part.slice(0, separator).trim() !== name$1) continue;
		return decodeURIComponent(part.slice(separator + 1).trim());
	}
}
/**
* Read a bearer credential from an `Authorization` header.
* @param header - the raw header value, or undefined.
* @returns the token, or undefined when the header is absent or not a bearer.
*/
function readBearer(header$1) {
	if (header$1 === void 0) return void 0;
	return /^Bearer +(\S+)$/i.exec(header$1.trim())?.[1];
}

//#endregion
//#region lib/types/auth/pairing.js
// 03-pairing.js — окно одноразового кода и содержимое QR.
/**
* The live pairing window.
*
* At most one code is outstanding: a second `issue()` replaces the first, so
* an operator who re-opens the pairing screen cannot accidentally leave a
* forgotten invitation valid behind them.
*/
var PairingWindow = class {
	#current;
	/**
	* Issue a fresh code, replacing any outstanding one.
	* @param digits - length of the numeric code.
	* @param windowMs - how long it stays claimable.
	* @param now - current epoch millis.
	* @returns the new code.
	*/
	issue(digits, windowMs, now) {
		let code = "";
		while (code.length < digits) code += String(randomInt(0, 10));
		this.#current = {
			code,
			expiresAt: now + windowMs
		};
		return this.#current;
	}
	/**
	* The outstanding code, if one is still claimable.
	* @param now - current epoch millis.
	* @returns the code, or undefined when none is outstanding or it expired.
	*/
	peek(now) {
		if (this.#current === void 0) return void 0;
		if (now >= this.#current.expiresAt) {
			this.#current = void 0;
			return;
		}
		return this.#current;
	}
	/**
	* Claim the outstanding code.
	*
	* Success consumes it, so a code intercepted in transit is worthless once
	* the intended device has used it — and an operator who sees an unexpected
	* "already paired" is being told the code leaked.
	* @param candidate - the code as presented.
	* @param now - current epoch millis.
	* @returns true when the code matched and has now been consumed.
	*/
	claim(candidate, now) {
		const current = this.peek(now);
		if (current === void 0) return false;
		if (!constantTimeEqual(candidate, current.code)) return false;
		this.#current = void 0;
		return true;
	}
	/** Withdraw any outstanding code. */
	clear() {
		this.#current = void 0;
	}
};
/**
* Build the payload a QR code or a copied link carries.
* @param parts - the relay's reachable origins, certificate identity, and live code.
* @returns the payload, ready to serialize.
*/
function pairingPayload(parts) {
	return {
		v: 1,
		kind: "dsh-relay-pair",
		url: parts.url,
		...parts.plainUrl !== void 0 && { plainUrl: parts.plainUrl },
		...parts.fingerprint !== void 0 && { fingerprint: parts.fingerprint },
		code: parts.code.code,
		expiresAt: parts.code.expiresAt
	};
}

//#endregion
//#region lib/types/auth/ratelimit.js
// 04-ratelimit.js — ограничение частоты запросов и блокировка перебора.
/**
* Per-address request throttling and sign-in lockout.
*
* Both are keyed by source address and held in memory only: they are abuse
* controls, not durable policy, and losing them on restart is correct — the
* credentials themselves are what survive.
* @module dsh-relay/auth/ratelimit
*/
/** How long an idle address's counters are kept before being dropped. */
const IDLE_EVICTION_MS = 36e5;
/** Window the request rate is measured over. */
const WINDOW_MS = 6e4;
/**
* Request and sign-in throttles, keyed by source address.
*
* The eviction sweep is the only timer; the caller owns it through
* {@link dispose} so a plugin unload leaves nothing running.
*/
var Throttle = class {
	limits;
	#addresses = /* @__PURE__ */ new Map();
	#sweep;
	/**
	* @param limits.requestsPerMinute - requests one address may make per minute.
	* @param limits.maxFailures - failed sign-ins before lockout.
	* @param limits.lockoutMs - how long a lockout lasts.
	*/
	constructor(limits) {
		this.limits = limits;
		this.#sweep = setInterval(() => {
			this.#evict();
		}, IDLE_EVICTION_MS);
		this.#sweep.unref();
	}
	/**
	* Counters for one address, created on first sight.
	* @param address - normalized source address.
	* @returns the live counters.
	*/
	#for(address) {
		let counters = this.#addresses.get(address);
		if (counters === void 0) {
			counters = {
				requests: [],
				failures: 0,
				lockedUntil: 0
			};
			this.#addresses.set(address, counters);
		}
		return counters;
	}
	/**
	* Record one request and report whether it exceeds the rate limit.
	* @param address - normalized source address.
	* @param now - current epoch millis.
	* @returns true when the request is over the limit and must be refused.
	*/
	exceedsRate(address, now) {
		const counters = this.#for(address);
		const cutoff = now - WINDOW_MS;
		while (counters.requests.length > 0 && counters.requests[0] <= cutoff) counters.requests.shift();
		counters.requests.push(now);
		return counters.requests.length > this.limits.requestsPerMinute;
	}
	/**
	* Whether sign-in from this address is currently locked out.
	* @param address - normalized source address.
	* @param now - current epoch millis.
	* @returns epoch millis the lockout ends, or undefined when not locked.
	*/
	lockedUntil(address, now) {
		const counters = this.#addresses.get(address);
		if (counters === void 0 || counters.lockedUntil <= now) return void 0;
		return counters.lockedUntil;
	}
	/**
	* Record a failed sign-in, locking the address out at the threshold.
	* @param address - normalized source address.
	* @param now - current epoch millis.
	*/
	recordFailure(address, now) {
		const counters = this.#for(address);
		counters.failures += 1;
		if (counters.failures >= this.limits.maxFailures) {
			counters.failures = 0;
			counters.lockedUntil = now + this.limits.lockoutMs;
		}
	}
	/**
	* Clear the failure counter after a successful sign-in.
	* @param address - normalized source address.
	*/
	recordSuccess(address) {
		const counters = this.#addresses.get(address);
		if (counters === void 0) return;
		counters.failures = 0;
		counters.lockedUntil = 0;
	}
	/** Drop counters for addresses that have gone quiet. */
	#evict() {
		const cutoff = Date.now() - IDLE_EVICTION_MS;
		for (const [address, counters] of this.#addresses) if ((counters.requests.at(-1) ?? 0) <= cutoff && counters.lockedUntil <= Date.now()) this.#addresses.delete(address);
	}
	/** Stop the eviction sweep and drop every counter. */
	dispose() {
		clearInterval(this.#sweep);
		this.#addresses.clear();
	}
};

//#endregion
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
//#region lib/types/config.js
// 03-config.js — схема настроек relay и её согласованность.
/**
* The settings form's fields, and the reason each one carries `.volatile()`.
*
* On dsh 0.1.7 the Plugins page builds an entry's form with `volatileForm()`,
* which keeps **only** the fields whose nearest marked ancestor is volatile and
* returns `undefined` for a schema with none. `describe()` then drops any entry
* whose form came back `undefined`, so a schema with no `.volatile()` is a
* schema with no settings page at all — not an empty one, an absent one.
*
* `.volatile()` also makes the resolved value a **live handle** rather than a
* copy, which is why {@link plainConfig} reads through them on every use.
*
* The annotation is deliberately `z<ConfigSchema>` rather than left to
* inference: the inferred type is schemastery's internal `ObjectS`/`ObjectT`
* pair, which cannot be written down, and the two types it must line up with —
* `Config` for plugin code and `ConfigSchema` for the handles — are already
* declared. `@deepseek-ai/dsh-agent-default-model` reaches the same place by
* inferring throughout, which only works because it never needs the plain type.
*/
const Config = z.object({
	bind: z.string().default("0.0.0.0").description("Listen address of the primary (TLS) listener.").volatile(),
	port: z.natural().max(65535).default(3443).description("Listen port of the primary listener.").volatile(),
	stateDir: z.string().required(),
	trustedHosts: z.array(String).default([]).description("Extra authorities this relay answers to, beyond those derived from its bind.").volatile(),
	publicHostnames: z.array(String).default([]).description("Extra certificate names and pairing authorities, for a port-forwarded deployment.").volatile(),
	tls: z.union([
		"self-signed",
		"files",
		"off"
	]).default("self-signed").description("Transport posture of the primary listener.").volatile(),
	tlsCertPath: z.string().default("").description("Certificate path, required when tls is \"files\".").volatile(),
	tlsKeyPath: z.string().default("").description("Private key path, required when tls is \"files\".").volatile(),
	auth: z.union([
		"password",
		"device-token",
		"both"
	]).default("both").description("Credential classes the relay accepts.").volatile(),
	sessionTtlMs: z.natural().min(6e4).default(432e5).description("Lifetime of a browser sign-in cookie, in milliseconds.").volatile(),
	deviceTokenTtlMs: z.natural().min(6e4).default(2592e6).description("Lifetime of a paired device token, in milliseconds.").volatile(),
	pairingWindowMs: z.natural().min(1e4).default(3e5).description("How long a pairing code stays claimable, in milliseconds.").volatile(),
	pairingCodeLength: z.natural().min(6).max(12).default(8).description("Digits in a numeric pairing passcode.").volatile(),
	maxFailedAttempts: z.natural().min(1).default(5).description("Failed sign-ins from one address before it is locked out.").volatile(),
	lockoutMs: z.natural().min(1e3).default(9e5).description("Lockout duration after maxFailedAttempts, in milliseconds.").volatile(),
	rateLimitPerMinute: z.natural().min(1).default(600).description("Requests per minute per source address, across every path.").volatile(),
	privilegedMethods: z.union(["allow-authenticated", "loopback-only"]).default("allow-authenticated").description("Whether an authenticated remote client reaches the harness configuration plane.").volatile(),
	extraProxyPaths: z.array(String).default([]).description("Path prefixes proxied beyond the built-in set; each must start with \"/\".").volatile(),
	proxyTimeoutMs: z.natural().min(1e3).default(12e4).description("Upstream response deadline for a proxied request, in milliseconds.").volatile(),
	compat: z.object({
		addressGrants: z.boolean().default(true).description("Accept requests from an address a paired device was last seen on. Not authentication.").volatile(),
		addressGrantTtlMs: z.natural().min(6e4).default(864e5).description("Lifetime of one address grant, in milliseconds.").volatile(),
		plainPort: z.natural().max(65535).default(0).description("Extra plain-HTTP listener port for clients that cannot speak TLS. Zero disables it.").volatile()
	}),
	uiLink: z.boolean().default(true).description("Add a link to the relay pages into the harness web UI.").volatile(),
	mdns: z.boolean().default(true).description("Advertise _dsh._tcp over mDNS.").volatile(),
	mdnsName: z.string().default("").description("Service name used in the mDNS advertisement; empty derives one from the hostname.").volatile()
});
/**
* Read the live values out of a resolved {@link ConfigSchema}.
*
* Every `.volatile()` field resolves to a handle rather than a value, so the
* plugin's own code — which has no business knowing about handles — reads
* through them here, once, at the boundary. Calling this on every use is the
* point: it is what makes a settings edit visible to a running relay instead of
* frozen at the value the process started with.
*
* `stateDir` is the one plain field and is copied straight across.
*
* @param config - the resolved schema instance handed to `apply`.
* @returns a snapshot of the current configuration, in plain values.
*/
function plainConfig(config) {
	return {
		bind: config.bind.get(),
		port: config.port.get(),
		stateDir: config.stateDir,
		trustedHosts: [...config.trustedHosts.get()],
		publicHostnames: [...config.publicHostnames.get()],
		tls: config.tls.get(),
		tlsCertPath: config.tlsCertPath.get(),
		tlsKeyPath: config.tlsKeyPath.get(),
		auth: config.auth.get(),
		sessionTtlMs: config.sessionTtlMs.get(),
		deviceTokenTtlMs: config.deviceTokenTtlMs.get(),
		pairingWindowMs: config.pairingWindowMs.get(),
		pairingCodeLength: config.pairingCodeLength.get(),
		maxFailedAttempts: config.maxFailedAttempts.get(),
		lockoutMs: config.lockoutMs.get(),
		rateLimitPerMinute: config.rateLimitPerMinute.get(),
		privilegedMethods: config.privilegedMethods.get(),
		extraProxyPaths: [...config.extraProxyPaths.get()],
		proxyTimeoutMs: config.proxyTimeoutMs.get(),
		compat: {
			addressGrants: config.compat.addressGrants.get(),
			addressGrantTtlMs: config.compat.addressGrantTtlMs.get(),
			plainPort: config.compat.plainPort.get()
		},
		uiLink: config.uiLink.get(),
		mdns: config.mdns.get(),
		mdnsName: config.mdnsName.get()
	};
}
/**
* Reject a configuration whose fields contradict each other.
*
* Self-contained constraints the schema cannot express fail here, at load,
* rather than at the first request that trips over them.
* @param config - the resolved configuration.
* @throws {Error} naming the field pair that cannot hold together.
*/
function assertCoherent(config) {
	if (config.tls === "files" && (config.tlsCertPath === "" || config.tlsKeyPath === "")) throw new Error("dsh-relay: tls \"files\" requires both tlsCertPath and tlsKeyPath");
	if (config.compat.plainPort !== 0 && config.compat.plainPort === config.port) throw new Error("dsh-relay: compat.plainPort must differ from port");
	for (const path of config.extraProxyPaths) if (!path.startsWith("/")) throw new Error(`dsh-relay: extraProxyPaths entry ${JSON.stringify(path)} must start with "/"`);
}

//#endregion
//#region lib/types/badge.js
// 04-badge.js — ссылка на страницы relay внутри интерфейса harness.
/**
* A way back to the relay's own pages from inside the harness UI.
*
* The relay ships its operational pages on its own listener, so a person
* looking at the chat had no way to reach pairing, the device list, or the
* password form except by typing a path they had to already know.
*
* `ctx.webServer.tapIndex` is the seam: a pure html-to-html transform the SPA
* server runs over every index response, the same mechanism the client module
* system uses to inject its boot manifest.
*
* The href stays relative, which reads correctly through the relay and works
* with no script at all. It also works on the harness's own loopback port,
* where a relative `/relay/...` would otherwise hit the single-page
* application's catch-all and land the person back in the chat — the dead end
* this link exists to remove. What saves it there is a redirect the plugin
* registers on the harness's own web server; see `redirectRoute` in
* `src/index.ts`.
* @module dsh-relay/badge
*/
/** Element id, also the guard against a double injection. */
const ELEMENT_ID$1 = "dsh-relay-link";
/** The anchor and its stylesheet, injected before the closing body tag. */
const MARKUP$1 = `<a id="${ELEMENT_ID$1}" href="/relay/devices" title="dsh-relay — pairing, devices, and password">
<svg width="14" height="14" viewBox="0 0 22 22" fill="none" aria-hidden="true"><circle cx="11" cy="11" r="2.4" fill="currentColor"/><path d="M6.6 6.6a6.2 6.2 0 0 0 0 8.8M15.4 6.6a6.2 6.2 0 0 1 0 8.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
<span>Relay</span></a>
<style>
#${ELEMENT_ID$1} {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 2147483000;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
  background: var(--dsw-alias-bg-layer-2, #fff);
  color: var(--dsw-alias-label-secondary, #61666b);
  font: 12px/18px var(--dsw-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
  text-decoration: none;
  box-shadow: var(--dsw-shadow-lv1, 0 2px 4px 0 rgba(0, 0, 0, 0.05));
  opacity: 0.75;
  transition: opacity 0.2s var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1)),
    background 0.2s var(--ds-ease-in-out, cubic-bezier(0.4, 0, 0.2, 1));
}
#${ELEMENT_ID$1}:hover, #${ELEMENT_ID$1}:focus-visible {
  opacity: 1;
  color: var(--dsw-alias-label-primary, #0f1115);
  background: var(--dsw-alias-interactive-bg-hover, rgba(38, 49, 72, 0.06));
}
@media (prefers-reduced-motion: reduce) { #${ELEMENT_ID$1} { transition: none; } }
</style>`;
/**
* Add the link to one index document.
*
* Applied to every index response, including each single-page-application
* route fallback, so it is idempotent and never throws: it runs inside the
* harness's own response path, where a failure would break the page rather
* than just this link.
* @param html - the index document as the frontend server rendered it.
* @returns the document with the link before `</body>`, or unchanged when it
* is already present or there is no body element to inject into.
*/
function injectRelayLink(html) {
	if (html.includes(ELEMENT_ID$1)) return html;
	const close = html.lastIndexOf("</body>");
	if (close < 0) return html;
	return `${html.slice(0, close)}${MARKUP$1}
${html.slice(close)}`;
}

//#endregion
//#region lib/types/harness-session.js
// 05-harness-session.js — доступ к браузерной сессии самого harness.
/** Where `dsh-client-connection` keeps its cookie-signing secret. */
const RECORD_KEY = "client-connection/browser-session";
/** Cookie-name prefix, before the hashed authority. */
const COOKIE_PREFIX = "dsh-auth-";
/** Payload version the harness accepts. */
const COOKIE_PAYLOAD_VERSION = 1;
/** Stored-secret envelope version the harness writes. */
const STORED_SECRET_VERSION = 1;
/** Length of the signing secret, in bytes. */
const SECRET_BYTES = 32;
/**
* How long a minted cookie claims to be valid.
*
* Deliberately short. The harness rejects a cookie whose lifetime exceeds its
* own configured `cookieMaxAgeDays`, and the relay has no way to read that
* setting — so anything longer than the smallest plausible configuration would
* be refused on some deployments and not others. A cookie is minted per
* request and never travels further than loopback, so it needs no life at all
* beyond the request it rides.
*/
const LIFETIME_MS = 6e4;
function encodeBase64Url(value) {
	return Buffer.from(value).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/**
* Decode the stored secret, or undefined when the record is not one this
* version understands.
*
* A record in an unexpected shape is not repaired or replaced: the harness owns
* that file, and a relay that rewrote it could invalidate every browser session
* on the machine. Failing to mint is the safe direction — it costs remote
* access until the operator restarts, where guessing could cost the operator
* their own logged-in browser.
*/
function readSecret(record) {
	if (!isRecord(record) || record.kind !== "grant" || !isRecord(record.payload)) return void 0;
	if (record.payload.version !== STORED_SECRET_VERSION) return void 0;
	const secret = record.payload.secret;
	if (typeof secret !== "string") return void 0;
	const decoded = Buffer.from(secret.replaceAll("-", "+").replaceAll("_", "/"), "base64");
	return decoded.byteLength === SECRET_BYTES ? decoded : void 0;
}
/**
* The cookie name for one authority.
*
* Authority-scoped by design upstream, so one harness home can serve several
* web ports without their cookies colliding. The relay must therefore name the
* authority it actually forwards to — the loopback one it rewrites `Host` to —
* not the edge address the client reached it on.
*/
function cookieName(authority) {
	return COOKIE_PREFIX + encodeBase64Url(createHash("sha256").update(authority).digest());
}
/** Mints harness browser-session cookies for proxied requests. */
var HarnessSession = class HarnessSession {
	secret;
	constructor(secret) {
		this.secret = secret;
	}
	/**
	* The signing secret, for the resolver's rotation check.
	*
	* Package-internal by convention: it exists so {@link HarnessSessionResolver}
	* can tell a rotated secret from the one it memoized, and nothing outside
	* this module has a reason to read it.
	* @returns the 32-byte signing secret.
	*/
	get signingSecret() {
		return this.secret;
	}
	/**
	* Mint a session over a known secret, for callers that already read it.
	* @param secret - a 32-byte signing secret.
	* @returns a minter over that secret.
	*/
	static over(secret) {
		return new HarnessSession(secret);
	}
	/**
	* Load the harness's cookie-signing secret.
	*
	* @param ctx - plugin context; `ctx.credentials` is the harness's own store.
	* @returns a minter, or undefined when this harness keeps no such secret —
	*   which is every release before 0.1.2, where nothing needed one.
	*/
	static async load(ctx) {
		const credentials = ctx.get("credentials");
		if (credentials?.readRecord === void 0) return void 0;
		const secret = readSecret(await credentials.readRecord(RECORD_KEY).catch(() => void 0));
		return secret === void 0 ? void 0 : new HarnessSession(secret);
	}
	/**
	* A minter that reads the secret **on every request**, so a harness that had
	* not written it yet at plugin-mount time still gets one.
	*
	* This exists because {@link load} alone is not enough, and the failure it
	* leaves behind is invisible from the phone: on a cold start the relay mounts
	* before `dsh-client-connection` has created its signing secret, `load`
	* returns `undefined`, and the relay then forwards **unauthenticated for the
	* rest of the process's life**. Every proxied request is answered 401 while
	* the relay's own pages keep working, so it reads as "the stream would not
	* open" rather than as a missing credential. Production carried a
	* `relay-hotreload.sh` workaround that edited the config after boot purely to
	* force this plugin to re-run `load`.
	*
	* The credentials provider's own contract is the reason this is a read
	* rather than a race to patch: "Resolution is per call: consumers re-resolve
	* at each operation and must not cache across operations." Reading it per
	* request is the documented usage, and it also picks up a secret rotated
	* under a running process.
	*
	* @param ctx - plugin context; `ctx.credentials` is the harness's own store.
	* @returns a resolver that yields a minter once the secret exists.
	*/
	static lazy(ctx) {
		return new HarnessSessionResolver(ctx);
	}
	/**
	* A minter backed by a secret of the caller's choosing. Tests only.
	* @param secret - a 32-byte signing secret.
	* @returns a minter over that secret.
	*/
	static forTesting(secret = randomBytes(SECRET_BYTES)) {
		return new HarnessSession(secret);
	}
	/**
	* The `Cookie` header value proving a browser session for [authority].
	* @param authority - the upstream `host:port` this request will carry.
	* @returns one `name=value` pair, ready to send as `Cookie`.
	*/
	cookieFor(authority) {
		const issuedAt = Date.now();
		const expiresAt = issuedAt + LIFETIME_MS;
		const body = encodeBase64Url(Buffer.from(JSON.stringify({
			version: COOKIE_PAYLOAD_VERSION,
			authority,
			issuedAt,
			expiresAt
		}), "utf8"));
		const signature = encodeBase64Url(createHmac("sha256", this.secret).update(body).digest());
		return `${cookieName(authority)}=v1.${body}.${signature}`;
	}
};
/**
* Resolves the harness browser session per request, retrying until it exists.
*
* Once the secret has been seen it is memoized: the read is cheap, but this
* sits on the path of every proxied request and every WebSocket upgrade, and a
* disk read per request for a value that does not change is waste. The
* memoized value is dropped only if the store later stops answering, so a
* rotated or removed secret is picked up rather than frozen.
*
* A *missing* secret is never memoized — that is the whole point. The negative
* result is what a cold start produces, and caching it is precisely the bug
* this class exists to fix.
*/
var HarnessSessionResolver = class {
	ctx;
	#cached;
	/** Set once the store has answered with a usable record, so misses after that are logged once. */
	#warned = false;
	/**
	* @param ctx - plugin context; `ctx.credentials` is the harness's own store.
	*/
	constructor(ctx) {
		this.ctx = ctx;
	}
	/**
	* The current minter, reading the store when it is not already known.
	* @returns a minter, or undefined while the harness has no such secret —
	*   which is every release before 0.1.2, and the first moments of a cold
	*   start on 0.1.2 or later.
	*/
	async current() {
		const credentials = this.ctx.get("credentials");
		if (credentials?.readRecord === void 0) return void 0;
		const secret = readSecret(await credentials.readRecord(RECORD_KEY).catch(() => void 0));
		if (secret === void 0) {
			this.#cached = void 0;
			return;
		}
		if (this.#cached === void 0 || !this.#cached.signingSecret.equals(secret)) {
			this.#cached = HarnessSession.over(secret);
			this.#warned = false;
		}
		return this.#cached;
	}
	/**
	* The current minter without touching the store.
	*
	* The request path cannot await: it builds headers synchronously for every
	* proxied call and every WebSocket upgrade. This returns whatever the last
	* {@link current} read resolved, which {@link HarnessSessionResolver} keeps
	* fresh in the background.
	* @returns the memoized minter, or undefined while none has been read.
	*/
	sync() {
		return this.#cached;
	}
	/**
	* Whether this resolver has ever produced a session.
	* @returns true once the harness's secret has been read successfully.
	*/
	get ready() {
		return this.#cached !== void 0;
	}
	/**
	* Note the first successful read, so a cold start can be reported as
	* recovered rather than passed over in silence.
	* @returns true the first time it is called after a miss, false afterwards.
	*/
	markRecovered() {
		if (this.#warned) return false;
		this.#warned = true;
		return true;
	}
};

//#endregion
//#region lib/types/mdns.js
// 06-mdns.js — объявление relay в локальной сети через mDNS.
/** The DNS-SD service type the relay publishes under. */
const SERVICE_TYPE = "dsh";
/**
* Publish the relay on the local network.
* @param advertisement - what to announce.
* @param onError - reports a failure to advertise; advertising is best-effort
* and must never take the relay down with it.
* @returns a disposer that withdraws the record.
*/
async function advertise(advertisement, onError) {
	let bonjour;
	try {
		bonjour = new (await (import("bonjour-service"))).Bonjour();
	} catch (error) {
		onError(`mDNS unavailable: ${String(error)}`);
		return async () => void 0;
	}
	try {
		bonjour.publish({
			name: advertisement.name === "" ? `DSH Relay on ${hostname()} (${String(advertisement.port)})` : advertisement.name,
			type: SERVICE_TYPE,
			port: advertisement.port,
			txt: {
				v: "1",
				relay: "dsh-relay",
				tls: advertisement.tls,
				...advertisement.plainPort !== void 0 && { plain: String(advertisement.plainPort) },
				...advertisement.fingerprint !== void 0 && { pin: advertisement.fingerprint }
			}
		}).on("error", (error) => {
			onError(`mDNS advertisement failed, continuing without it: ${String(error)}`);
		});
	} catch (error) {
		onError(`mDNS publish failed: ${String(error)}`);
		bonjour.destroy();
		return async () => void 0;
	}
	return async () => {
		await new Promise((resolve$1) => {
			bonjour.unpublishAll(() => {
				resolve$1();
			});
		});
		bonjour.destroy();
	};
}

//#endregion
//#region lib/types/paths.js
// 07-paths.js — каталог состояния relay и разбор DSH_HOME.
/** Directory name of the default harness home under the OS home directory. */
const DEFAULT_HOME_DIR = ".dsh";
/** Environment variable naming an explicit harness home. */
const HOME_ENV = "DSH_HOME";
/** Subdirectory of the harness home this plugin owns outright. */
const RELAY_DIR = "relay";
/**
* Expand the tilde prefixes the harness accepts in a configured path.
* @param path - configured path that may begin with `~`, `~/`, or `~\`.
* @returns the expanded path, or the original value when no prefix is present.
*/
function expandHomePath(path) {
	if (path === "~") return homedir();
	if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
	return path;
}
/**
* Resolve the directory holding this plugin's state, certificate, and key.
* @param ctx - plugin context, read for the optional `dshHomePath` service.
* @param configured - explicit override from plugin config; empty means unset.
* @returns the absolute directory path, not yet created on disk.
*/
function relayStateDir(ctx, configured) {
	if (configured !== void 0 && configured.trim().length > 0) return resolve(expandHomePath(configured));
	const provided = ctx.get("dshHomePath");
	if (typeof provided === "function") return provided(RELAY_DIR);
	const fromEnv = process.env[HOME_ENV];
	return join(resolve(expandHomePath(fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join(homedir(), DEFAULT_HOME_DIR))), RELAY_DIR);
}

//#endregion
//#region lib/types/settings-section.js
// 08-settings-section.js — раздел настроек relay в интерфейсе harness.
/**
* Publishing the relay's configuration to the harness settings plane, and
* following edits to it.
*
* **How this works on dsh 0.1.7, which is not how it worked before.**
*
* Through 0.1.5 a plugin registered a namespace imperatively —
* `ctx.settings.register(ns, schema, { base })` — and got back a scope to read
* and watch. That API is gone. On 0.1.7 the settings plane reads the schema off
* the **loader entry** itself (`entry.fiber.runtime.Config`) and serves the
* entry's own `id` as the namespace; writes land in the profile patch document
* and are re-resolved into the plugin's live config.
*
* So there is nothing to register here. The namespace is `relay`, which is the
* row id this bundle's patch declares, and it exists as soon as the row does —
* see the default export in `src/index.ts` for the half of that contract which
* is easy to miss and leaves no error behind.
*
* What is left to do is **follow the changes**. A `.volatile()` field resolves
* to a live handle rather than a copy, and a settings write swaps the value
* under the running plugin. The relay's listeners are built from that value, so
* a change has to reach {@link Supervisor.apply} — and taking a listener down
* is exactly the kind of side effect that must not happen while the plugin is
* unloading.
*
* @module dsh-relay/settings-section
*/
/**
* Value mirror of the `FiberState` members {@link isUnloading} compares
* against. A const enum has no runtime object to import, and the comparison
* happens at runtime.
*/
const FIBER_DISPOSED = 4;
const FIBER_UNLOADING = 5;
/** The settings namespace this plugin owns, in both halves. */
const RELAY_NAMESPACE = "relay";
/** Namespaces must be lowercase kebab-case, as the service brands them. */
const NAMESPACE_PATTERN = /^[a-z][\da-z]*(-[\da-z]+)*$/;
/**
* Whether the consumer's own fiber is tearing down, rather than merely losing
* the settings service.
*
* The distinction decides whether a change notification is useful or harmful:
* a provider detaching leaves the relay running, while the relay's own unload
* would have `onChange` rebuilding listeners over resources the teardown is
* releasing.
* @param ctx - the consumer's plugin context.
* @returns true while this plugin is unloading or disposed.
*/
function isUnloading(ctx) {
	const state = ctx.fiber.state;
	return state === FIBER_UNLOADING || state === FIBER_DISPOSED;
}
/**
* Follow edits to the relay's configuration.
*
* A settings write on 0.1.7 re-resolves the entry's config and emits
* `settings/document-updated` with the entry id. The plugin's own `config`
* object is a set of live handles, so by the time the event arrives the new
* values are already readable through it — the only thing needed here is to
* tell the relay to rebuild from them.
*
* A deployment without a settings plane never fires this, and the relay simply
* runs under the configuration it was composed with.
*
* @param ctx - the relay's plugin context.
* @param hooks.onChange - called after every change to the configuration.
* @returns a disposer removing the subscription.
*/
function followSettings(ctx, hooks) {
	if (!NAMESPACE_PATTERN.test(RELAY_NAMESPACE)) throw new Error(`dsh-relay: settings namespace ${JSON.stringify(RELAY_NAMESPACE)} must be lowercase kebab-case`);
	ctx.inject(["settings", "configEditor"], (scoped) => {
		if (scoped.get("configEditor").documentPath === void 0) return;
		const off = scoped.on("settings/document-updated", (ns) => {
			if (isUnloading(ctx)) return;
			if (ns !== RELAY_NAMESPACE) return;
			hooks.onChange();
		});
		scoped.effect(() => () => {
			off();
		}, "dsh-relay: settings subscription");
	});
	return () => void 0;
}

//#endregion
//#region lib/types/pages/theme.js
// 01-theme.js — тема оформления страниц relay.
/**
* The visual system the relay's own pages render in.
*
* These pages are served before the harness web application exists — a sign-in
* form cannot be a plugin inside the app it gates — so they cannot consume the
* harness's React primitives or its theme package. They reproduce the look
* instead: the same semantic `--dsw-alias-*` token names over the same values,
* the same system font stacks, and the same `body[data-ds-dark-theme]`
* switching the harness itself uses, so a person moving between the sign-in
* page and the application does not cross a visual seam.
*
* Only the tokens these pages actually use are reproduced. The upstream sheets
* are the authority for everything else; nothing here should grow into a
* second design system.
* @module dsh-relay/pages/theme
*/
/** Token definitions, the reset, and the component rules these pages need. */
const THEME_CSS = `
:root {
  --dsw-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC',
    'Hiragino Sans GB', 'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  --ds-font-family-code: 'SF Mono', 'JetBrains Mono', 'Fira Code', Consolas,
    'Liberation Mono', Menlo, Courier, 'PingFang SC', 'Microsoft YaHei';
  --ds-ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
  --ds-transition-duration: 0.2s;
  /* Shadows are the one family upstream does not flip between themes. */
  --dsw-shadow-lv1: 0 2px 4px 0 rgba(0, 0, 0, 0.05);
  --dsw-shadow-lv3:
    0 0 1px 0 rgba(0, 0, 0, 0.2), 0 0 4px 0 rgba(0, 0, 0, 0.02), 0 12px 32px 0 rgba(0, 0, 0, 0.08);
}

body {
  --dsw-alias-bg-base: rgb(255, 255, 255);
  --dsw-alias-bg-layer-1: rgb(255, 255, 255);
  --dsw-alias-bg-layer-2: rgb(255, 255, 255);
  --dsw-alias-bg-layer-3: rgb(255, 255, 255);
  --dsw-alias-bg-module-platform: rgb(245, 246, 247);
  --dsw-alias-border-l1: rgba(0, 0, 0, 0.04);
  --dsw-alias-border-l2: rgba(0, 0, 0, 0.1);
  --dsw-alias-border-l3: rgba(0, 0, 0, 0.12);
  --dsw-alias-brand-primary: rgb(15, 17, 21);
  --dsw-alias-button-primary-fill: rgb(15, 17, 21);
  --dsw-alias-button-primary-hover: rgb(67, 69, 74);
  --dsw-alias-interactive-bg-hover: rgba(38, 49, 72, 0.06);
  --dsw-alias-interactive-bg-active: rgba(38, 49, 72, 0.1);
  --dsw-alias-label-primary: rgb(15, 17, 21);
  --dsw-alias-label-secondary: rgb(97, 102, 107);
  --dsw-alias-label-tertiary: rgb(129, 133, 140);
  --dsw-alias-label-caption: rgb(173, 178, 184);
  --dsw-alias-label-dimmed: rgb(225, 229, 238);
  --dsw-alias-label-primary-foreground: rgb(255, 255, 255);
  --dsw-alias-scrollbar-bg-l2: rgb(229, 229, 229);
  --dsw-alias-scrollbar-hover-l2: rgb(212, 212, 212);
  --dsw-alias-state-business-primary: rgb(65, 118, 230);
  --dsw-alias-state-error-primary: rgb(236, 19, 19);
  --dsw-alias-state-success-primary: rgb(34, 197, 94);
  --dsw-alias-state-warn-primary: rgb(245, 158, 11);
  --dsw-alias-state-warn-tertiary: rgb(254, 245, 231);
  --dsw-alias-state-warn-label: rgb(221, 134, 41);
  --dsw-static-neutral-bluish-400: rgb(173, 178, 184);
  --dsw-specific-login-input: rgb(249, 250, 251);
  --dsw-specific-tip: rgb(245, 246, 247);
  /* Upstream has no state-error-tertiary alias, so an error notice was
     borrowing the amber warn surface. These are its red-100 and red-900 steps. */
  --dsw-specific-error-tip: rgb(254, 226, 226);
  --dsw-qr-ink: rgb(15, 17, 21);
  --dsw-qr-paper: rgb(255, 255, 255);
}

body[data-ds-dark-theme] {
  --dsw-alias-bg-base: rgb(21, 21, 23);
  --dsw-alias-bg-layer-1: rgb(35, 35, 36);
  --dsw-alias-bg-layer-2: rgb(44, 44, 46);
  --dsw-alias-bg-layer-3: rgb(53, 54, 56);
  --dsw-alias-bg-module-platform: rgb(53, 54, 56);
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.06);
  --dsw-alias-border-l2: rgba(255, 255, 255, 0.12);
  --dsw-alias-border-l3: rgba(255, 255, 255, 0.16);
  --dsw-alias-brand-primary: rgb(249, 250, 251);
  --dsw-alias-button-primary-fill: rgb(249, 250, 251);
  --dsw-alias-button-primary-hover: rgb(235, 238, 242);
  --dsw-alias-interactive-bg-hover: rgba(255, 255, 255, 0.08);
  --dsw-alias-interactive-bg-active: rgba(255, 255, 255, 0.14);
  --dsw-alias-label-primary: rgb(249, 250, 251);
  --dsw-alias-label-secondary: rgb(207, 211, 214);
  --dsw-alias-label-tertiary: rgb(173, 178, 184);
  --dsw-alias-label-caption: rgb(129, 133, 140);
  --dsw-alias-label-dimmed: rgb(67, 69, 74);
  --dsw-alias-label-primary-foreground: rgb(15, 17, 21);
  --dsw-alias-scrollbar-bg-l2: rgb(84, 85, 87);
  --dsw-alias-scrollbar-hover-l2: rgb(101, 103, 107);
  --dsw-alias-state-business-primary: rgb(103, 158, 254);
  --dsw-alias-state-error-primary: rgb(242, 90, 90);
  --dsw-alias-state-warn-tertiary: rgb(39, 36, 31);
  --dsw-specific-login-input: rgb(27, 27, 28);
  --dsw-specific-tip: rgb(53, 54, 56);
  --dsw-specific-error-tip: rgb(87, 12, 12);
  --dsw-qr-ink: rgb(15, 17, 21);
  --dsw-qr-paper: rgb(249, 250, 251);
}

html { height: 100%; }
body { min-height: 100%; margin: 0; }

body {
  font-family: var(--dsw-font-family);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
  display: flex;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
}

button, input, select, textarea { font-family: inherit; }

/* Scrollbar skin, ported from the harness sheet so a scrolling relay page does
   not render a light native bar over the dark palette. The @supports gate is
   load-bearing rather than defensive: a non-auto scrollbar-color makes
   Chromium and Safari drop every ::-webkit-scrollbar rule, so declaring both
   paths silences the hover state on exactly the engines that implement it. */
@supports not selector(::-webkit-scrollbar) {
  body, body * {
    scrollbar-width: thin;
    scrollbar-color: var(--dsw-alias-scrollbar-bg-l2) transparent;
  }
}
@supports selector(::-webkit-scrollbar) {
  ::-webkit-scrollbar { width: 8px; height: 8px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { border-radius: 4px; background: var(--dsw-alias-scrollbar-bg-l2); }
  ::-webkit-scrollbar-thumb:hover { background: var(--dsw-alias-scrollbar-hover-l2); }
}

/* Centred by auto margins rather than align-items: a flex item centred on the
   cross axis is clipped past the top of the viewport once it grows taller than
   one, and the device list does. Auto margins centre while there is room and
   yield to the scroll when there is not. */
.card {
  width: min(380px, 100%);
  margin: auto 0;
  box-sizing: border-box;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 24px;
  background: var(--dsw-alias-bg-layer-2);
  box-shadow: var(--dsw-shadow-lv3);
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.card.wide { width: min(560px, 100%); }

.brand { display: flex; align-items: center; gap: 8px; color: var(--dsw-alias-brand-primary); }
.brand svg { display: block; }
.brand .wordmark { font-size: 16px; line-height: 24px; font-weight: 600; letter-spacing: 0.08em; }

h1 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 500; }
p { margin: 0; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-secondary); }
.caption { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
code, .mono { font-family: var(--ds-font-family-code); font-size: 13px; line-height: 20px; }

form { display: flex; flex-direction: column; gap: 12px; }
label { font-size: 13px; line-height: 20px; font-weight: 500; }

input[type="text"], input[type="password"] {
  height: 36px;
  box-sizing: border-box;
  width: 100%;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  background: var(--dsw-specific-login-input);
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 22px;
  outline: none;
  transition: border-color var(--ds-transition-duration) var(--ds-ease-in-out);
}
input:focus-visible { border-color: var(--dsw-alias-state-business-primary); }

/* The capsule from the harness's Button primitive: h36, pad 0/14, gap 4, r18,
   with the compact form at h28/r14. The .btn class carries the same geometry
   onto an anchor, so a navigation target is a control rather than a line of
   underlined text: every action on these pages ends up with one weight and one
   hit target whether it posts a form or follows a link. */
button, .btn {
  height: 36px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 0 14px;
  border: none;
  border-radius: 18px;
  cursor: pointer;
  font-size: 14px;
  line-height: 22px;
  font-weight: 400;
  color: var(--dsw-alias-label-primary);
  background: transparent;
  text-decoration: none;
  transition: background var(--ds-transition-duration) var(--ds-ease-in-out),
    color var(--ds-transition-duration) var(--ds-ease-in-out);
}
button:disabled { cursor: not-allowed; opacity: 0.4; }
button.primary, .btn.primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
}
button.primary:hover:not(:disabled), .btn.primary:hover {
  background: var(--dsw-alias-button-primary-hover);
}
button.outline, .btn.outline { border: 1px solid var(--dsw-alias-border-l2); }
button.outline:hover:not(:disabled), .btn.outline:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
button.ghost, .btn.ghost { color: var(--dsw-alias-label-secondary); }
button.ghost:hover:not(:disabled), .btn.ghost:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
button.ghost:active:not(:disabled), .btn.ghost:active {
  background: var(--dsw-alias-interactive-bg-active);
}
button.sm, .btn.sm { height: 28px; padding: 0 10px; border-radius: 14px; font-size: 12px; line-height: 18px; }
button:focus-visible, .btn:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}

/* One row of equal-weight actions. A form is a column everywhere else on these
   pages, which would otherwise put every single-button form on a line of its
   own; inside an action row it is only the wrapper its button needs to post,
   so display: contents lets the button itself be the flex item. */
.actions { display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; }
.actions form { display: contents; }
.actions > .btn, .actions > button, .actions form > button { flex: 1 1 auto; }
.actions.stack { flex-direction: column; }
.actions.stack > .btn, .actions.stack > button, .actions.stack form > button { flex: none; }

/* A link inside running prose keeps the accent treatment. A link wearing .btn
   is a control, and a control never underlines. */
a { color: var(--dsw-alias-state-business-primary); text-decoration: none; }
a:hover, a:focus-visible { text-decoration: underline; }
a.btn:hover, a.btn:focus-visible { text-decoration: none; }

.notice {
  border-radius: 12px;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 20px;
}
.notice.error { background: var(--dsw-specific-error-tip); color: var(--dsw-alias-state-error-primary); }
.notice.warn { background: var(--dsw-alias-state-warn-tertiary); color: var(--dsw-alias-state-warn-label); }
.notice.tip { background: var(--dsw-specific-tip); color: var(--dsw-alias-label-secondary); }

.rows { display: flex; flex-direction: column; gap: 8px; }
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1);
}
.row .meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.row .name { font-size: 14px; line-height: 22px; font-weight: 500; }
.row .sub { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.row form { display: contents; }
.row .end { display: flex; align-items: center; gap: 10px; flex: none; }

/* The StateDot halo: a full-size layer at a tenth opacity behind a solid core
   inset to 60%, both riding the colour its state sets on the element. */
.dot {
  position: relative;
  display: inline-block;
  width: 10px;
  height: 10px;
  flex: none;
}
.dot::before, .dot::after { content: ''; position: absolute; border-radius: 50%; background: currentColor; }
.dot::before { inset: 0; opacity: 0.1; }
.dot::after { inset: 20%; }
.dot.ok { color: var(--dsw-alias-state-success-primary); }
.dot.off { color: var(--dsw-alias-label-caption); }

.qr { display: flex; justify-content: center; padding: 16px; border-radius: 12px; background: var(--dsw-qr-paper); }
.qr svg { width: 100%; height: auto; max-width: 260px; shape-rendering: crispEdges; }

.code {
  text-align: center;
  font-family: var(--ds-font-family-code);
  font-size: 24px;
  line-height: 32px;
  letter-spacing: 0.24em;
  font-weight: 600;
}

.fingerprint { word-break: break-all; color: var(--dsw-alias-label-tertiary); }

@media (prefers-reduced-motion: reduce) {
  * { transition: none !important; animation: none !important; }
}
`;
/**
* Theme bootstrap, inlined right after `<body>`.
*
* The harness sets `color-scheme` and the dark attribute synchronously before
* first paint for the same reason: doing it from a stylesheet media query
* alone leaves a light flash on a dark device.
*/
const THEME_BOOT_JS = `
try {
  var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  document.body.toggleAttribute('data-ds-dark-theme', dark);
} catch (error) { /* a browser without matchMedia simply stays light */ }
`;

//#endregion
//#region lib/types/pages/layout.js
// 02-layout.js — каркас HTML-страницы relay.
/**
* Escape a value for interpolation into HTML text or a quoted attribute.
* @param value - the untrusted string.
* @returns the escaped string.
*/
function escapeHtml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/**
* This project's own mark: a relay glyph, drawn in `currentColor` so it takes
* the brand ink of whichever theme is active, the way the harness's own marks
* do.
*/
const MARK = `<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
  <circle cx="11" cy="11" r="2.4" fill="currentColor"/>
  <path d="M6.6 6.6a6.2 6.2 0 0 0 0 8.8M15.4 6.6a6.2 6.2 0 0 1 0 8.8"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
  <path d="M3.6 3.6a10.4 10.4 0 0 0 0 14.8M18.4 3.6a10.4 10.4 0 0 1 0 14.8"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity="0.4"/>
</svg>`;
/**
* Render one complete page.
* @param options.title - the document title.
* @param options.body - already-escaped markup for the card's contents.
* @param options.wide - render the wider card used by the admin page.
* @returns the full HTML document.
*/
function page(options) {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(options.title)}</title>
<style>${THEME_CSS}</style>
</head>
<body>
<script>${THEME_BOOT_JS}<\/script>
<main class="card${options.wide === true ? " wide" : ""}">
  <div class="brand">${MARK}<span class="wordmark">DSH RELAY</span></div>
  ${options.body}
</main>
</body>
</html>
`;
}

//#endregion
//#region lib/types/pages/views.js
// 03-views.js — страницы: вход, пароль, спаривание, устройства.
/** Render a relative timestamp the way a device list wants it. */
function since(timestamp, now) {
	if (timestamp === void 0) return "never";
	const seconds = Math.max(0, Math.round((now - timestamp) / 1e3));
	if (seconds < 60) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${String(minutes)} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return `${String(hours)} h ago`;
	return `${String(Math.round(hours / 24))} d ago`;
}
/**
* The sign-in page.
* @param options.error - message to show above the form.
* @param options.next - path to return to after a successful sign-in.
* @returns the full HTML document.
*/
function loginPage(options) {
	return page({
		title: "Sign in",
		body: `
  <h1>Sign in</h1>
  <p>This relay fronts a DeepSeek Harness on this machine.</p>
  ${options.error === void 0 ? "" : `<div class="notice error">${escapeHtml(options.error)}</div>`}
  <form method="post" action="/relay/login">
    <input type="hidden" name="next" value="${escapeHtml(options.next)}">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
    <button class="primary" type="submit">Sign in</button>
  </form>`
	});
}
/**
* The page that sets a password, or replaces the one already set.
*
* This is deliberately separate from the sign-in page. A request from the
* machine running the harness is already the operator — asking it for a
* password would be theatre, since whoever is there has a shell — so the
* sign-in page redirects it straight through. That left first-run setup with
* nowhere to happen, which is what this page is for.
* @param options.hasPassword - whether a password already exists.
* @param options.error - message to show above the form.
* @param options.next - path to return to afterwards.
* @returns the full HTML document.
*/
function passwordPage(options) {
	const notice = options.error === void 0 ? "" : `<div class="notice error">${escapeHtml(options.error)}</div>`;
	const heading = options.hasPassword ? "Change the password" : "Set a password";
	const lead = options.hasPassword ? "Replacing it does not sign anyone out. Use <a href=\"/relay/devices\">sign out everywhere</a> on the devices page for that." : "Nobody can sign in from the network until you set one. Anyone who does can run commands on this machine, because that is what the agent does.";
	return page({
		title: heading,
		body: `
  <h1>${escapeHtml(heading)}</h1>
  <p>${lead}</p>
  ${notice}
  <form method="post" action="/relay/password">
    <input type="hidden" name="next" value="${escapeHtml(options.next)}">
    <label for="password">${options.hasPassword ? "New password" : "Password"}</label>
    <input id="password" name="password" type="password" autocomplete="new-password" required minlength="10" autofocus>
    <label for="confirm">Confirm</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" required minlength="10">
    <button class="primary" type="submit">${options.hasPassword ? "Replace password" : "Set password"}</button>
  </form>
  <p class="caption">At least 10 characters. Only reachable from the machine running the harness${options.hasPassword ? ", or with an existing session" : ""}.</p>`
	});
}
/**
* The operator's pairing page: the QR, the code, and what a device does with them.
* @param options - the live invitation and the origins it points at.
* @returns the full HTML document.
*/
function pairPage(options) {
	const plain = options.plainUrl === void 0 ? "" : `<div class="notice tip">DSH Mobile 0.5.0 cannot use TLS, so it connects over the plain listener instead:
       <br><span class="mono">${escapeHtml(options.plainUrl)}</span></div>`;
	const pin = options.fingerprint === void 0 ? `<div class="notice warn">This relay is serving plaintext. Anything on the network path can read the traffic.</div>` : `<p class="caption fingerprint">Certificate pin (SHA-256/SPKI)<br><span class="mono">${escapeHtml(options.fingerprint)}</span></p>`;
	return page({
		wide: true,
		title: "Pair a device",
		body: `
  <h1>Pair a device</h1>
  <p>Scan this on the device, or open <span class="mono">${escapeHtml(options.url)}/relay/pair</span> there and type the code.</p>
  <div class="qr">${options.qrSvg}</div>
  <div class="code">${escapeHtml(options.code)}</div>
  <p class="caption">Expires in ${String(options.expiresInSeconds)} seconds, and works once.</p>
  ${plain}
  ${pin}
  <div class="actions">
    <form method="post" action="/relay/pair/new">
      <button class="outline" type="submit">New code</button>
    </form>
    <a class="btn outline" href="/relay/devices">Paired devices</a>
  </div>
  <div class="actions">
    <a class="btn ghost" href="/">Back to the harness</a>
  </div>`
	});
}
/**
* The device-facing enrolment form.
* @param options.error - message to show above the form.
* @param options.code - a code carried in the URL, prefilled.
* @returns the full HTML document.
*/
function claimPage(options) {
	return page({
		title: "Pair this device",
		body: `
  <h1>Pair this device</h1>
  <p>Enter the code shown on the machine running the harness.</p>
  ${options.error === void 0 ? "" : `<div class="notice error">${escapeHtml(options.error)}</div>`}
  <form method="post" action="/relay/pair">
    <label for="code">Pairing code</label>
    <input id="code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code"
           required value="${escapeHtml(options.code ?? "")}" ${options.code === void 0 ? "autofocus" : ""}>
    <label for="name">Device name</label>
    <input id="name" name="name" type="text" required maxlength="64" placeholder="Pixel 8"
           ${options.code === void 0 ? "" : "autofocus"}>
    <button class="primary" type="submit">Pair</button>
  </form>`
	});
}
/**
* Confirmation after a device enrols, carrying the token exactly once.
* @param options - the minted credential and the addresses it works from.
* @returns the full HTML document.
*/
function pairedPage(options) {
	const grant = options.granted ? `<div class="notice tip">This device's network address is now accepted for a limited time, so DSH Mobile 0.5.0 —
       which cannot send a credential of its own — can connect. It is not a substitute for the token: it stops working
       when the address changes, and it never reaches the harness settings or credentials.</div>` : "";
	const plain = options.plainUrl === void 0 ? "" : `<p class="caption">In DSH Mobile, connect to <span class="mono">${escapeHtml(options.plainUrl)}</span>.</p>`;
	return page({
		wide: true,
		title: "Device paired",
		body: `
  <h1>Paired</h1>
  <p><strong>${escapeHtml(options.deviceName)}</strong> is enrolled. Its token is shown once and never again — a client
     that supports it sends this as <span class="mono">Authorization: Bearer &lt;token&gt;</span>.</p>
  <div class="notice tip mono" style="word-break: break-all">${escapeHtml(options.token)}</div>
  ${grant}
  ${plain}
  <div class="actions">
    <a class="btn primary" href="/">Open the harness</a>
    <a class="btn outline" href="/relay/devices">Paired devices</a>
  </div>`
	});
}
/**
* The device list, with revocation.
* @param options - the enrolled devices and the relay's current posture.
* @returns the full HTML document.
*/
function devicesPage(options) {
	const rows = options.devices.length === 0 ? "<p class=\"caption\">Nothing paired yet.</p>" : options.devices.map((device) => `
    <div class="row">
      <div class="meta">
        <span class="name">${escapeHtml(device.name)}</span>
        <span class="sub">last seen ${escapeHtml(since(device.lastSeenAt, options.now))}${device.lastAddress === void 0 ? "" : ` &middot; ${escapeHtml(device.lastAddress)}`}</span>
      </div>
      <div class="end">
        <span class="dot ${device.lastSeenAt === void 0 ? "off" : "ok"}"></span>
        <form method="post" action="/relay/devices/revoke">
          <input type="hidden" name="deviceId" value="${escapeHtml(device.id)}">
          <button class="outline sm" type="submit">Revoke</button>
        </form>
      </div>
    </div>`).join("");
	const pin = options.fingerprint === void 0 ? "" : `<p class="caption fingerprint">Pin <span class="mono">${escapeHtml(options.fingerprint)}</span></p>`;
	const plain = options.plainUrl === void 0 ? "" : `<div class="row"><div class="meta"><span class="name">Plain listener</span>
       <span class="sub">${escapeHtml(options.plainUrl)} &middot; compatibility clients only</span></div>
       <span class="dot ok"></span></div>`;
	return page({
		wide: true,
		title: "Paired devices",
		body: `
  <h1>Paired devices</h1>
  <div class="rows">
    <div class="row">
      <div class="meta">
        <span class="name">Relay</span>
        <span class="sub">${escapeHtml(options.url)} &middot; TLS ${escapeHtml(options.tlsMode)}</span>
      </div>
      <span class="dot ok"></span>
    </div>
    ${plain}
  </div>
  ${pin}
  <div class="rows">${rows}</div>
  <div class="row">
    <div class="meta">
      <span class="name">Password sign-in</span>
      <span class="sub">${options.hasPassword ? "set" : "not set — nobody can sign in from the network"}</span>
    </div>
    <span class="dot ${options.hasPassword ? "ok" : "off"}"></span>
  </div>
  <div class="actions">
    <form method="post" action="/relay/pair/new">
      <button class="primary" type="submit">Pair a new device</button>
    </form>
  </div>
  <div class="actions">
    <a class="btn outline" href="/relay/password">${options.hasPassword ? "Change the password" : "Set a password"}</a>
    <form method="post" action="/relay/signout-everywhere">
      <button class="outline" type="submit">Sign out everywhere</button>
    </form>
  </div>
  <p class="caption">Signing out everywhere rotates the signing key: every paired device and every browser session stops working at once.</p>
  <div class="actions">
    <a class="btn ghost" href="/">Back to the harness</a>
  </div>`
	});
}
/**
* A standalone message, used for errors and confirmations.
* @param options.title - the heading and document title.
* @param options.message - body copy.
* @param options.kind - which notice styling to use.
* @returns the full HTML document.
*/
function messagePage(options) {
	return page({
		title: options.title,
		body: `
  <h1>${escapeHtml(options.title)}</h1>
  <div class="notice ${options.kind ?? "tip"}">${escapeHtml(options.message)}</div>
  <div class="actions">
    <a class="btn outline" href="/">Back</a>
  </div>`
	});
}

//#endregion
//#region lib/types/wire.js
// 10-wire.js — тело запроса, куки, ответы и отрисовка QR.
/**
* Small HTTP helpers shared by the relay's own routes.
*
* Bodies here are forms and short JSON documents, never proxied traffic, so
* they are read into memory against a hard cap. Anything larger is a mistake
* or an attack, not a request this relay serves.
* @module dsh-relay/wire
*/
/** Ceiling on a request body the relay parses itself. */
const MAX_BODY_BYTES = 64 * 1024;
/** Cache directives for every relay-owned response: none of it may be stored. */
const NO_STORE = "no-store, no-cache, must-revalidate, private";
/**
* Read a bounded request body.
* @param req - the inbound request.
* @returns the body text, or undefined when it exceeded the cap.
*/
async function readBody(req) {
	const chunks = [];
	let total = 0;
	for await (const chunk of req) {
		const buffer = chunk;
		total += buffer.length;
		if (total > MAX_BODY_BYTES) {
			req.destroy();
			return;
		}
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString("utf8");
}
/**
* Parse a body as either a form post or a JSON document.
* @param req - the inbound request, read for its content type.
* @param body - the body text.
* @returns a flat field map; a malformed JSON body yields an empty map.
*/
function parseFields(req, body) {
	if ((req.headers["content-type"] ?? "").includes("application/json")) try {
		const parsed = JSON.parse(body);
		const fields$1 = {};
		for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") fields$1[key] = value;
		return fields$1;
	} catch {
		return {};
	}
	const fields = {};
	for (const [key, value] of new URLSearchParams(body)) fields[key] = value;
	return fields;
}
/** Whether the client asked for a JSON answer rather than a page. */
function wantsJson(req) {
	if ((req.headers["content-type"] ?? "").includes("application/json")) return true;
	const accept = req.headers.accept ?? "";
	return accept.includes("application/json") && !accept.includes("text/html");
}
/**
* Send an HTML page.
* @param res - the response to write.
* @param status - HTTP status.
* @param html - the document.
* @param extraHeaders - additional headers, such as a Set-Cookie.
*/
function sendHtml(res, status, html, extraHeaders = {}) {
	res.writeHead(status, {
		"content-type": "text/html; charset=utf-8",
		"cache-control": NO_STORE,
		"referrer-policy": "same-origin",
		"x-content-type-options": "nosniff",
		"x-frame-options": "DENY",
		...extraHeaders
	});
	res.end(html);
}
/**
* Send a JSON document.
* @param res - the response to write.
* @param status - HTTP status.
* @param value - the payload.
* @param extraHeaders - additional headers.
*/
function sendJson(res, status, value, extraHeaders = {}) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": NO_STORE,
		"x-content-type-options": "nosniff",
		...extraHeaders
	});
	res.end(JSON.stringify(value));
}
/**
* Send a redirect.
* @param res - the response to write.
* @param location - the target path; always relative to this origin.
* @param extraHeaders - additional headers, such as a Set-Cookie.
*/
function sendRedirect(res, location, extraHeaders = {}) {
	res.writeHead(303, {
		location,
		"cache-control": NO_STORE,
		...extraHeaders
	});
	res.end();
}
/**
* Build the `Set-Cookie` value for the relay's session cookie.
* @param options.name - cookie name.
* @param options.value - cookie value; an empty value clears the cookie.
* @param options.maxAgeSeconds - lifetime; zero clears the cookie.
* @param options.secure - mark the cookie `Secure`, for a TLS listener.
* @returns the header value.
*/
function sessionCookie(options) {
	const parts = [
		`${options.name}=${encodeURIComponent(options.value)}`,
		"Path=/",
		"HttpOnly",
		"SameSite=Strict",
		`Max-Age=${String(options.maxAgeSeconds)}`
	];
	if (options.secure) parts.push("Secure");
	return parts.join("; ");
}
/**
* Confine a caller-supplied return path to this origin.
*
* A `next` parameter that could name another origin would turn the sign-in
* page into an open redirect, which is exactly the primitive a phishing page
* wants from a host the operator already trusts.
* @param value - the requested path.
* @returns a same-origin absolute path, defaulting to the root.
*/
function safeNextPath(value) {
	if (value === null || !value.startsWith("/")) return "/";
	if (value.startsWith("//") || value.startsWith("/\\")) return "/";
	return value;
}

//#endregion
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
		url: context.qrOrigin ?? context.origin,
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
			url: context.qrOrigin ?? context.origin,
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
				url: context.qrOrigin ?? context.origin,
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
			url: context.qrOrigin ?? context.origin,
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
//#region lib/types/secure-context.js
// 12-secure-context.js — подмена secure context для старых браузеров.
/**
* A UUID for a page the browser refuses to call secure.
*
* `crypto.randomUUID` is `[SecureContext]`: browsers expose it over HTTPS and
* on loopback, and nowhere else.
*
* **Harness 0.1.2 fixed this upstream.** `randomUuid()` in
* `packages/client/connection/src/client/random-uuid.ts` now builds a v4 UUID
* from `crypto.getRandomValues()`, which browsers do expose on an insecure
* origin, so a 0.1.2 page served from a plain-HTTP LAN address works without
* this shim.
*
* It is kept for the harness releases before that. Through 0.1.1 the browser
* client minted ids with `randomUUID` in three places — `mintRpcId`, which
* every unary RPC went through, `createMessage`, and the conversation plugin's
* draft attachments. Served over plain HTTP the function was simply absent,
* and the first thing to reach for it was the readiness handshake:
* `host.describe` threw, the catch aborted the generation, and both
* `/api/events.*` sockets — which held that generation's abort signal — closed
* while still CONNECTING. The supervisor retried forever, so sessions,
* workspaces and the model picker never arrived. Unary calls kept working,
* which is why sign-in looked fine and only the live page was dead.
*
* The relay reaches that page anyway. `tls: 'off'` in front of a proxy that
* terminates elsewhere is a documented configuration here, and the plain
* compatibility listener serves the same application, so this is not an
* unsupported topology the relay can decline to have.
*
* The shim is a head script rather than a rewrite of the proxied bundle:
* `ctx.webServer.tapIndex` already carries the **Relay** link, an inline
* classic script runs before the deferred module the index loads, and one
* definition on `crypto` covers all three call sites at once. Nothing in the
* response path is buffered — `proxy/http.ts` streams bodies and must keep
* streaming them.
*
* It defines nothing where the real function exists, so a TLS deployment and
* the harness's own loopback port parse it and return. Against 0.1.2 it still
* defines `randomUUID` on a plain-HTTP page, where nothing calls it any more:
* harmless, and the price of one build serving both releases.
* @module dsh-relay/secure-context
*/
/** Element id, also the guard against a double injection. */
const ELEMENT_ID = "dsh-relay-secure-context";
/** The script element spliced into the document. */
const MARKUP = `<script id="${ELEMENT_ID}">(function(){try{
var c=globalThis.crypto;
if(!c||typeof c.randomUUID==='function'||typeof c.getRandomValues!=='function')return;
var mint=function(){
var b=c.getRandomValues(new Uint8Array(16));
b[6]=(b[6]&0x0f)|0x40;b[8]=(b[8]&0x3f)|0x80;
var h='';for(var i=0;i<16;i++)h+=(b[i]+0x100).toString(16).slice(1);
return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};
try{Object.defineProperty(c,'randomUUID',{value:mint,configurable:true,writable:true})}
catch(e){c.randomUUID=mint}
}catch(e){}})()<\/script>`;
/**
* Add the shim to one index document.
*
* Applied to every index response, single-page-application route fallbacks
* included, so it is idempotent and never throws.
*
* Placement is the whole point: the index loads its application as
* `<script type="module">`, which is deferred to after parsing, so an inline
* classic script anywhere in the document runs first. It goes after the
* opening head tag regardless, which is where the harness renders its own
* structured head rows.
*
* A document with neither a head nor a body element is returned unchanged
* rather than having the script prepended. Prepending would put an element
* ahead of `<!doctype html>`, and a doctype that is not the first token is
* ignored — the page would render in quirks mode, which is a worse failure
* than the one this fixes.
* @param html - the index document as the frontend server rendered it.
* @returns the document with the shim, or unchanged when it is already
* present or there is no element to inject after.
*/
function injectSecureContextShim(html) {
	if (html.includes(ELEMENT_ID)) return html;
	const open = /<head(?:\s[^>]*)?>/i.exec(html) ?? /<body(?:\s[^>]*)?>/i.exec(html);
	if (open === null) return html;
	const at = open.index + open[0].length;
	return `${html.slice(0, at)}${MARKUP}${html.slice(at)}`;
}

//#endregion
//#region lib/types/service-worker.js
// 12b-service-worker.js — кэш оболочки и ассетов, переживающий очистку HTTP-кэша.
//
// ПРАВКА ВЕНДОРА (локально). Зачем: страница тянет ~350 КБ (brotli) ассетов и
// ещё раз запрашивает оболочку при каждой перезагрузке; мобильные браузеры к
// тому же вычищают HTTP-кэш за неделю — телефон качает всё заново, тратя
// мобильный трафик.
//
// Что делает воркер:
//   * при установке скачивает оболочку и все ассеты, на которые она ссылается,
//     в Cache Storage — дальше они доступны, даже если HTTP-кэш очищен;
//   * навигацию (саму страницу) отдаёт из кэша сразу, а свежую версию тянет
//     фоном и кладёт на следующий раз: перезагрузка перестаёт быть «скачать всё»;
//   * /assets/* отдаёт из кэша, в сеть идёт только за новыми (новый хэш в имени).
//
// Данные не кэшируются: API, websocket и чужие origin идут мимо воркера, поэтому
// устаревших сессий или ответов модели быть не может.
var SERVICE_WORKER_PATH = "/dsh-mobile-sw.js";
var SERVICE_WORKER_MARKER = "dsh-mobile-sw";
var SERVICE_WORKER_SOURCE = `/* dsh-relay: кэш оболочки и ассетов. */
const CACHE = "dsh-mobile-shell-v3";
const SHELL = "/";
/** Скачать оболочку и все ассеты, на которые она ссылается. */
async function precache() {
	const cache = await caches.open(CACHE);
	const response = await fetch(SHELL, { cache: "no-store" });
	if (!response.ok) return;
	const html = await response.clone().text();
	await cache.put(SHELL, response);
	const assets = new Set();
	const pattern = /(?:src|href)="([^"]*\\/assets\\/[^"]+)"/g;
	let match = pattern.exec(html);
	while (match !== null) {
		assets.add(match[1]);
		match = pattern.exec(html);
	}
	await Promise.all([...assets].map(async (url) => {
		try {
			const asset = await fetch(url);
			if (asset.ok) await cache.put(url, asset);
		} catch {
			/* один недоступный ассет не должен срывать установку */
		}
	}));
}
self.addEventListener("install", (event) => {
	event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		// Кэши прошлых версий удаляем: имена файлов сменились вместе со сборкой.
		const names = await caches.keys();
		await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
		await self.clients.claim();
	})());
});
/** Отдать из кэша, иначе сходить в сеть и запомнить. */
async function cacheFirst(request, key) {
	const cache = await caches.open(CACHE);
	const hit = await cache.match(key ?? request);
	if (hit !== undefined) return hit;
	const response = await fetch(request);
	if (response.ok) await cache.put(key ?? request, response.clone());
	return response;
}
/** Оболочку берём из сети, кэш — только когда сети нет. */
async function networkFirstShell(request) {
	const cache = await caches.open(CACHE);
	try {
		const response = await fetch(request);
		if (response.ok) await cache.put(SHELL, response.clone());
		return response;
	} catch {
		const hit = await cache.match(SHELL);
		if (hit !== undefined) return hit;
		return new Response("Страница недоступна без сети", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
	}
}
self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	let url;
	try {
		url = new URL(request.url);
	} catch {
		return;
	}
	if (url.origin !== self.location.origin) return;
	// Оболочку всегда спрашиваем у сети: она весит единицы килобайт, зато новая
	// сборка видна сразу. Кэш остаётся страховкой на случай, когда сети нет.
	if (request.mode === "navigate") {
		event.respondWith(networkFirstShell(request));
		return;
	}
	if (/^\\/assets\\//.test(url.pathname)) {
		event.respondWith(cacheFirst(request));
	}
});
`;
/** Inline registration spliced into the document head. */
var SERVICE_WORKER_MARKUP = `<script id="${SERVICE_WORKER_MARKER}">(function(){try{
if(!("serviceWorker" in navigator))return;
addEventListener("load",function(){
navigator.serviceWorker.register("${SERVICE_WORKER_PATH}",{scope:"/"}).catch(function(){});
});
}catch(e){}})()<\/script>`;
/**
* Add the service worker registration to one index document.
*
* Idempotent like the secure-context shim: the marker attribute is the guard
* against a double injection after a client-side navigation.
* @param html - the index document as the frontend server rendered it.
* @returns the document with the registration, or unchanged.
*/
function injectServiceWorker(html) {
	if (html.includes(SERVICE_WORKER_MARKER)) return html;
	const open = /<head(?:\s[^>]*)?>/i.exec(html) ?? /<body(?:\s[^>]*)?>/i.exec(html);
	if (open === null) return html;
	const at = open.index + open[0].length;
	return `${html.slice(0, at)}${SERVICE_WORKER_MARKUP}${html.slice(at)}`;
}

//#endregion
//#region lib/types/privileged.js
// 13-privileged.js — какие методы API доступны удалённому клиенту.
/**
* The harness methods the relay keeps to the machine running the harness.
*
* Through harness 0.1.1 this was a mirror. The harness pinned its own
* `PRIVILEGED_METHODS` list, re-checking each entry against an empty trusted
* list so only a genuine loopback caller reached them, and the relay's `Host`
* rewrite would have silently lifted that pin — so the relay re-imposed the
* same list before proxying.
*
* **Harness 0.1.2 deleted that list.** There is no method tier left upstream:
* the whole `/api` surface is authenticated uniformly, and possession of a
* browser session authorizes all of it — the same authority the web app has
* after creating a session. So this is no longer a mirror of anything. It is
* the relay's own policy, and the only thing standing between a paired phone
* and the operator's credential store.
*
* That difference matters for how the list is maintained. A mirror could be
* checked for drift against the harness; this cannot, because there is nothing
* to check it against. It is a judgement about which operations a *remote*
* device should reach, and it is deliberately conservative: an endpoint this
* list does not name is reachable by any paired device.
* @module dsh-relay/privileged
*/
/**
* Remote endpoints the relay serves only to loopback callers under
* `privilegedMethods: 'loopback-only'`.
*
* They are privileged for two different reasons. The settings and credential
* domains mutate the operator's configuration and secret store, and READING
* them is equally sensitive: `settings/describe` returns every exposed
* namespace and `credentials/describe` reports whether an arbitrary
* environment variable is configured and where from. `directoryPicker/*` and
* `session/openWorkspacePath` act on the host desktop. `llm/discoverModels`
* carries a draft credential and makes the host issue a request to a URL the
* caller chose, which probes whatever the host can reach and the client
* cannot. Agent-preset authoring names the plugins a session runs.
*
* Endpoint names are `namespace/method`, matching the 0.1.2 wire. The 0.1.1
* `domain.method` spelling is retained alongside each so one relay build keeps
* gating correctly against either harness — a name that no longer exists
* simply never matches.
*/
const PRIVILEGED_METHODS = new Set([
	"agentPresets/read",
	"agentPresets/copy",
	"agentPresets/deletePreset",
	"agentPreset.read",
	"agentPreset.copy",
	"agentPreset.openDocument",
	"agentPreset.remove",
	"directoryPicker/pick",
	"directoryPicker/list",
	"directoryPicker/createDirectory",
	"session/openWorkspacePath",
	"host.pickDirectory",
	"host.openPath",
	"host.listDirectory",
	"host.createDirectory",
	"settings/describe",
	"settings/update",
	"settings/replace",
	"settings/mutate",
	"settings/openSettingsDocument",
	"settings/openAgentPresetDirectory",
	"settings.describe",
	"settings.openDocument",
	"settings.update",
	"settings.replace",
	"settings.mutate",
	"credentials/describe",
	"credentials/set",
	"credentials/unset",
	"credentials.describe",
	"credentials.set",
	"credentials.unset",
	"llm/discoverModels",
	"llm.discoverModels"
]);
/**
* The `/api` endpoint a pathname addresses.
*
* Everything after `/api/`, not just the first segment: 0.1.2 endpoints carry
* two (`settings/update`), and taking only the first would have matched the
* whole `settings` namespace — including calls this list does not name.
* @param pathname - the request pathname, already decoded.
* @returns the endpoint name, or undefined when the path is not an `/api` call.
*/
function apiMethodOf(pathname) {
	return pathname.startsWith("/api/") ? pathname.slice(5) : void 0;
}
/**
* Whether a request must be refused because it addresses a pinned endpoint.
* @param pathname - the request pathname.
* @param allowed - whether this credential class may reach the pinned set.
* @returns true when the request must be refused before proxying.
*/
function isPinnedMethod(pathname, allowed) {
	if (allowed) return false;
	const method = apiMethodOf(pathname);
	return method !== void 0 && PRIVILEGED_METHODS.has(method);
}

//#endregion
//#region lib/types/proxy/rewrite.js
// 01-rewrite.js — переписывание заголовков при проксировании.
/**
* Header translation between the relay's edge and the loopback harness.
*
* Two jobs. The first is ordinary proxy hygiene: hop-by-hop headers belong to
* one connection and must not be forwarded onto another.
*
* The second is the deliberate one. The harness answers `/api` only to a
* loopback authority, and pins its configuration plane to the same test, so
* the relay presents itself as loopback. That rewrite is only safe because the
* relay has already applied its own fence to the original headers — see
* `fence.ts`. Rewriting before that check would hand every rebound page a
* loopback identity.
* @module dsh-relay/proxy/rewrite
*/
/**
* Headers scoped to a single hop, per RFC 9110. Forwarding any of them
* confuses the upstream connection's own framing and keep-alive state.
*/
const HOP_BY_HOP = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade"
]);
/**
* Headers carrying the relay's own credentials. They authenticate the client
* to the relay and mean nothing upstream, so they stop here rather than
* travelling on to a process that does not expect them.
*
* `cookie` is stripped and then *replaced*: from harness 0.1.2 the upstream
* wants a browser session of its own, and the one the client sent is the
* relay's, signed with a different secret for a different authority. Passing it
* through would be as useless as passing nothing, and would leak the relay's
* session into a process that has no business seeing it.
*/
const RELAY_ONLY = new Set(["authorization", "cookie"]);
/**
* Build the header map for one upstream request.
* @param headers - the inbound headers, already past the fence.
* @param loopbackAuthority - `127.0.0.1:<port>` of the harness web server.
* @param options.keepUpgrade - retain `connection` and `upgrade` for a WebSocket handshake.
* @param options.cookie - the harness browser session to present, when this
*   harness requires one. Absent leaves the request unauthenticated, which a
*   pre-0.1.2 harness accepts and a 0.1.2 one answers 401.
* @returns the headers to send upstream.
*/
function upstreamHeaders(headers, loopbackAuthority$1, options = {}) {
	const dropped = new Set(HOP_BY_HOP);
	if (options.keepUpgrade === true) {
		dropped.delete("connection");
		dropped.delete("upgrade");
	}
	const connection = headers.connection;
	if (typeof connection === "string" && options.keepUpgrade !== true) for (const name$1 of connection.split(",")) dropped.add(name$1.trim().toLowerCase());
	const out = {};
	for (const [name$1, value] of Object.entries(headers)) {
		if (value === void 0) continue;
		const lower = name$1.toLowerCase();
		if (dropped.has(lower) || RELAY_ONLY.has(lower)) continue;
		if (lower === "host" || lower === "origin" || lower === "referer") continue;
		out[lower] = value;
	}
	out.host = loopbackAuthority$1;
	if (options.cookie !== void 0) out.cookie = options.cookie;
	if (headers.origin !== void 0) out.origin = `http://${loopbackAuthority$1}`;
	if (headers.referer !== void 0) out.referer = `http://${loopbackAuthority$1}/`;
	return out;
}
/**
* Build the header map for one downstream response.
* @param headers - the upstream response headers.
* @returns the headers to send to the client, hop-by-hop entries removed.
*/
function downstreamHeaders(headers) {
	const out = {};
	for (const [name$1, value] of Object.entries(headers)) {
		if (value === void 0) continue;
		if (HOP_BY_HOP.has(name$1.toLowerCase())) continue;
		out[name$1] = value;
	}
	return out;
}
/**
* Normalize a socket peer address for use as a grant key and log field.
*
* Node reports an IPv4 peer on a dual-stack listener as `::ffff:a.b.c.d`;
* treating that as a different address from `a.b.c.d` would make a grant
* issued over one listener invisible to the other.
* @param address - the raw `socket.remoteAddress`, possibly undefined.
* @returns the normalized address, or an empty string when unknown.
*/
function normalizeAddress(address) {
	if (address === void 0) return "";
	return (/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1] ?? address).toLowerCase();
}

//#endregion
//#region lib/types/proxy/http.js
// 02-http.js — проксирование обычных запросов.
/** The authority the harness sees, and compares its own fence against. */
function loopbackAuthority(target) {
	return `${target.host}:${String(target.port)}`;
}
/**
* Кэширование ответов harness.
*
* ПРАВКА ВЕНДОРА (локально): harness не отдаёт `cache-control` для хэшированных
* ассетов сборки. Браузер поэтому качал все ~470 КБ при каждом входе — это и
* тратило мобильный трафик. Имя файла у Vite содержит хэш содержимого, так что такие
* ответы можно кэшировать навсегда; HTML наоборот не кэшируем, иначе телефон
* залипнет на старой сборке.
* @param headers - the response headers, already stripped of hop-by-hop entries.
* @param pathname - the request path, used to recognise build assets.
*/
function applyCacheHeaders(headers, pathname) {
	const hasCacheControl = Object.keys(headers).some((key) => key.toLowerCase() === "cache-control");
	if (hasCacheControl) return;
	if (/^\/assets\/[^/]+\.(?:js|mjs|css|woff2?|ttf|png|svg|webp|ico)$/i.test(pathname)) {
		headers["cache-control"] = "public, max-age=31536000, immutable";
		return;
	}
	if (pathname === "/" || pathname.endsWith(".html")) {
		headers["cache-control"] = "no-cache";
	}
}
/**
* Forward one request and stream its response back.
* @param req - the inbound request; its body is piped upstream.
* @param res - the response to write; owned entirely by this call.
* @param target - the loopback harness.
* @returns resolution once the response is finished or an error was reported.
*/
/** Кэш brotli-вариантов ассетов: имя файла содержит хэш сборки. */
var BROTLI_CACHE = /* @__PURE__ */ new Map();
/** Предел числа файлов в кэше: одна сборка — это единицы ассетов. */
var BROTLI_CACHE_MAX = 32;
/** Слишком крупные файлы не пережимаем: brotli займёт процессор надолго. */
var BROTLI_MAX_RAW = 8 * 1024 * 1024;
/** Пути неизменяемых ассетов сборки. */
var ASSET_PATH = /^\/assets\/[^/]+\.(?:js|mjs|css|woff2?|ttf|png|svg|webp|ico)$/i;
var brotliAsync = promisify(brotliCompress);
var gunzipAsync = promisify(gunzip);
/**
* Значение заголовка без учёта регистра.
* @param headers - the header map.
* @param name - lowercase header name.
* @returns the value, or undefined.
*/
function headerValue(headers, name) {
	for (const [key, value] of Object.entries(headers)) if (key.toLowerCase() === name) return value;
	return void 0;
}
/**
* Поставить заголовок, убрав прежний в любом регистре.
*
* Иначе Node отправит два `Content-Length` — и браузер отбросит ответ.
* @param headers - the header map, mutated in place.
* @param name - lowercase header name.
* @param value - the value to set.
*/
function setHeader(headers, name, value) {
	for (const key of Object.keys(headers)) if (key.toLowerCase() === name) delete headers[key];
	headers[name] = value;
}
/**
* Клиент принимает brotli.
* @param value - the `accept-encoding` request header.
* @returns true when `br` is among the accepted codings.
*/
function acceptsBrotli(value) {
	return typeof value === "string" && /(?:^|,)\s*br\s*(?:;|,|$)/i.test(value);
}
/**
* Отдать готовый brotli-вариант из памяти, не трогая harness.
* @param res - the response to write.
* @param entry - the cached body and its content type.
*/
function sendBrotli(res, entry) {
	res.writeHead(200, {
		"content-type": entry.type,
		"content-encoding": "br",
		"content-length": String(entry.body.length),
		"cache-control": "public, max-age=31536000, immutable",
		vary: "accept-encoding"
	});
	res.end(entry.body);
}
/**
* Forward one request and stream its response back.
*
* ПРАВКА ВЕНДОРА (локально): harness умеет только gzip, а brotli на этих
* бандлах даёт ещё −15% (замер: 404 КБ gzip против 342 КБ brotli). Поэтому
* ассет, который клиент умеет принимать сжатым brotli, relay пережимает сам и
* держит результат в памяти: имя файла содержит хэш сборки, так что кэш не
* протухает, а повторные запросы вообще не доходят до harness.
* @param req - the inbound request; its body is piped upstream.
* @param res - the response to write; owned entirely by this call.
* @param target - the loopback harness.
* @returns resolution once the response is finished or an error was reported.
*/
function forward(req, res, target) {
	return new Promise((resolve$1) => {
		const pathname = (req.url ?? "/").split("?")[0];
		const wantsBrotli = acceptsBrotli(headerValue(req.headers, "accept-encoding"));
		/** Картинка, вынутая из бандла плагина: отдаём из памяти, без harness. */
		const inline = INLINE_ASSETS.get(pathname);
		if (inline !== undefined) {
			res.writeHead(200, {
				"content-type": "image/png",
				"content-length": String(inline.length),
				"cache-control": "public, max-age=31536000, immutable"
			});
			res.end(inline);
			resolve$1();
			return;
		}
		const cached = BROTLI_CACHE.get(pathname);
		if (wantsBrotli && cached !== void 0) {
			sendBrotli(res, cached);
			resolve$1();
			return;
		}
		const upstream = request({
			host: target.host,
			port: target.port,
			method: req.method ?? "GET",
			path: req.url ?? "/",
			headers: upstreamHeaders(req.headers, loopbackAuthority(target), { cookie: target.session()?.cookieFor(loopbackAuthority(target)) }),
			agent: false
		});
		upstream.setTimeout(target.timeoutMs, () => {
			upstream.destroy(/* @__PURE__ */ new Error("dsh-relay: upstream timed out"));
		});
		const fail = (status, message) => {
			if (!res.headersSent) {
				res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
				res.end(message);
			} else res.destroy();
			resolve$1();
		};
		upstream.on("error", () => {
			fail(502, "upstream unavailable");
		});
		upstream.on("response", (upstreamRes) => {
			const headers = downstreamHeaders(upstreamRes.headers);
			applyCacheHeaders(headers, pathname);
			const status = upstreamRes.statusCode ?? 502;
			/**
			 * Бандл «Аккаунта» везёт иллюстрации онбординга прямо в base64:
			 * 5 МБ из 5,15 МБ файла. Вырезаем их до отправки на телефон — на
			 * экране приветствия они всё равно нужны далеко не сразу.
			 */
			const extractInline = status === 200 && PLUGIN_BUNDLE_WITH_INLINE.test(pathname);
			if (!extractInline && (!wantsBrotli || status !== 200 || !ASSET_PATH.test(pathname))) {
				res.writeHead(status, headers);
				upstreamRes.pipe(res);
				upstreamRes.on("error", () => {
					res.destroy();
				});
				res.on("close", () => {
					upstreamRes.destroy();
				});
				upstreamRes.on("end", () => {
					resolve$1();
				});
				return;
			}
			const chunks = [];
			upstreamRes.on("data", (chunk) => {
				chunks.push(chunk);
			});
			upstreamRes.on("error", () => {
				res.destroy();
				resolve$1();
			});
			upstreamRes.on("end", () => {
				void (async () => {
					const body = Buffer.concat(chunks);
					try {
						const encoding = String(headerValue(headers, "content-encoding") ?? "").toLowerCase();
						let raw = encoding === "gzip" ? await gunzipAsync(body) : body;
						if (extractInline) raw = Buffer.from(extractInlineAssets(raw.toString("utf8")).body, "utf8");
						if (raw.length > BROTLI_MAX_RAW) throw new Error("asset too large to recompress");
						const compressed = wantsBrotli ? await brotliAsync(raw, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }) : raw;
						const type = String(headerValue(headers, "content-type") ?? "application/octet-stream");
						if (wantsBrotli) {
							if (BROTLI_CACHE.size >= BROTLI_CACHE_MAX) {
								const oldest = BROTLI_CACHE.keys().next().value;
								BROTLI_CACHE.delete(oldest);
							}
							BROTLI_CACHE.set(pathname, { body: compressed, type });
						}
						if (!res.destroyed) {
							if (wantsBrotli) {
								setHeader(headers, "content-encoding", "br");
								setHeader(headers, "vary", "accept-encoding");
							} else {
								setHeader(headers, "content-encoding", "identity");
							}
							if (extractInline) setHeader(headers, "cache-control", "public, max-age=31536000, immutable");
							setHeader(headers, "content-length", String(compressed.length));
							res.writeHead(status, headers);
							res.end(compressed);
						}
					} catch {
						// fail-soft: отдаём исходный ответ, лишь бы страница открылась.
						if (!res.destroyed) {
							res.writeHead(status, headers);
							res.end(body);
						}
					}
					resolve$1();
				})();
			});
		});
		req.on("error", () => {
			upstream.destroy();
		});
		req.pipe(upstream);
	});
}

//#endregion
// 03-inline-assets.js — вынос тяжёлых inline-картинок из бандлов плагинов.
//
// ПРОБЛЕМА. Клиентский бандл «Аккаунта» (@deepseek-ai/dsh-client-ui-settings-account)
// весит 5,03 МБ, и 5,07 МБ из них — восемь PNG, вшитых в JS как data:image/png;base64.
// Это иллюстрации экрана приветствия и «пополнения». Они уезжают на телефон при
// каждом холодном входе, хотя видны только на одном экране и только один раз.
// base64 вдобавок не сжимается: gzip такого бандла — 3,75 МБ против 42 КБ после
// выноса картинок.
//
// РЕШЕНИЕ. Relay читает бандл с loopback, заменяет каждую большую data-URI на
// собственный URL картинки и отдаёт PNG отдельным ответом. Браузер запрашивает
// их только когда соответствующий <img> действительно отрисован, а сам бандл
// приходит уже без мегабайтов.
//
// Имя картинки — sha1 от её содержимого, поэтому URL стабилен между запросами и
// перезапусками relay, а кэш можно объявить immutable.
/**
 * Префикс маршрута вынесенных картинок. Не пересекается с маршрутами harness:
 * всё, чего relay не знает, он проксирует на loopback.
 */
const INLINE_ASSETS_PATH = "/__dsh-mobile/inline/";
/** data-URI PNG, достаточно крупная, чтобы её стоило выносить (base64 > 100 КБ). */
const INLINE_PNG_DATA = /data:image\/png;base64,[A-Za-z0-9+/=]{100000,}/g;
/** Бандл, внутри которого лежат иллюстрации онбординга. */
const PLUGIN_BUNDLE_WITH_INLINE = /^\/plugins\/[^?]*dsh-client-ui-settings-account/;
/** Содержимое вынесенных картинок: путь -> PNG. */
const INLINE_ASSETS = /* @__PURE__ */ new Map();
/** Предел числа картинок: их всего восемь на сборку. */
const INLINE_ASSETS_MAX = 16;
/**
 * Положить картинку в память и вернуть её URL.
 * @param dataUri - исходная data:image/png;base64,... строка.
 * @returns путь, по которому relay её отдаст.
 */
function inlineAssetFor(dataUri) {
	const digest = createHash("sha1").update(dataUri).digest("hex").slice(0, 20);
	const path = `${INLINE_ASSETS_PATH}${digest}.png`;
	if (!INLINE_ASSETS.has(path)) {
		if (INLINE_ASSETS.size >= INLINE_ASSETS_MAX) {
			const oldest = INLINE_ASSETS.keys().next().value;
			INLINE_ASSETS.delete(oldest);
		}
		INLINE_ASSETS.set(path, Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64"));
	}
	return path;
}
/**
 * Заменить крупные inline-PNG на URL, которые отдаст relay.
 * @param source - текст бандла.
 * @returns текст без вшитых картинок и число заменённых.
 */
function extractInlineAssets(source) {
	let count = 0;
	const body = source.replace(INLINE_PNG_DATA, (dataUri) => {
		count += 1;
		return inlineAssetFor(dataUri);
	});
	return { body, count };
}
//#region lib/types/proxy/ws.js
// 03-ws.js — проксирование websocket-соединений.
/** Tracks live upgraded sockets so teardown can force them closed. */
var SocketLedger = class {
	#sockets = /* @__PURE__ */ new Set();
	/**
	* Register a socket and forget it again when it closes.
	* @param socket - the upgraded socket.
	*/
	track(socket) {
		this.#sockets.add(socket);
		socket.once("close", () => {
			this.#sockets.delete(socket);
		});
	}
	/** Destroy every tracked socket. */
	destroyAll() {
		for (const socket of this.#sockets) socket.destroy();
		this.#sockets.clear();
	}
	/** How many sockets are live. */
	get size() {
		return this.#sockets.size;
	}
};
/**
* Refuse an upgrade before it is established.
* @param socket - the client socket.
* @param status - HTTP status line code.
* @param reason - reason phrase, echoed into the body.
*/
function rejectUpgrade(socket, status, reason) {
	socket.end(`HTTP/1.1 ${String(status)} ${reason}\r\nConnection: close\r\n\r\n`);
}
/**
* Prepare a socket for interactive traffic.
*
* The default server socket timeout would silently kill an idle downlink, and
* Nagle batching adds latency to the small frames a streaming chat turn is
* made of.
* @param socket - the socket to configure.
*/
function tune(socket) {
	const tunable = socket;
	tunable.setNoDelay?.(true);
	tunable.setTimeout?.(0);
	tunable.setKeepAlive?.(true, 3e4);
}
/**
* Forward one upgrade to the harness and pipe the resulting sockets together.
* @param req - the upgrade request.
* @param socket - the client socket, still holding the handshake.
* @param head - bytes the client already sent past the handshake.
* @param target - the loopback harness.
* @param ledger - registry the established socket pair joins.
*/
function forwardUpgrade(req, socket, head, target, ledger) {
	const upstream = request({
		host: target.host,
		port: target.port,
		method: req.method ?? "GET",
		path: req.url ?? "/",
		headers: upstreamHeaders(req.headers, loopbackAuthority(target), {
			keepUpgrade: true,
			cookie: target.session()?.cookieFor(loopbackAuthority(target))
		}),
		agent: false
	});
	const abandon = () => {
		upstream.destroy();
		if (!socket.destroyed) socket.destroy();
	};
	socket.on("error", abandon);
	upstream.on("error", () => {
		if (!socket.destroyed) rejectUpgrade(socket, 502, "Bad Gateway");
		upstream.destroy();
	});
	upstream.on("response", (response) => {
		rejectUpgrade(socket, response.statusCode ?? 502, response.statusMessage ?? "Upgrade Failed");
		response.destroy();
	});
	upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
		const lines = [`HTTP/1.1 ${String(response.statusCode ?? 101)} ${response.statusMessage ?? "Switching Protocols"}`];
		for (const [name$1, value] of Object.entries(response.headers)) {
			if (value === void 0) continue;
			for (const single of Array.isArray(value) ? value : [value]) lines.push(`${name$1}: ${single}`);
		}
		socket.write(`${lines.join("\r\n")}\r\n\r\n`);
		tune(socket);
		tune(upstreamSocket);
		ledger.track(socket);
		ledger.track(upstreamSocket);
		upstreamSocket.on("error", abandon);
		socket.removeListener("error", abandon);
		socket.on("error", () => {
			upstreamSocket.destroy();
		});
		upstreamSocket.on("close", () => {
			socket.destroy();
		});
		socket.on("close", () => {
			upstreamSocket.destroy();
		});
		if (upstreamHead.length > 0) socket.write(upstreamHead);
		if (head.length > 0) upstreamSocket.write(head);
		upstreamSocket.pipe(socket);
		socket.pipe(upstreamSocket);
	});
	upstream.end();
}

//#endregion
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
 * The origin a pairing invitation should advertise.
 *
 * ПРАВКА ВЕНДОРА (локально): мост `/mobile-ui/pair` спрашивает relay по
 * loopback, поэтому `originOf` возвращал `https://127.0.0.1:3443` — и QR на
 * компьютере вёл на адрес самого телефона. Если запрос пришёл на loopback-имя,
 * а публичное имя известно (`publicHostnames`), в приглашение попадает оно.
 * @param req - the inbound request, read for the host it addressed.
 * @param secure - whether this listener speaks TLS.
 * @param publicHostnames - names the deployment is reached by from outside.
 * @returns the origin to put into the QR and the invitation.
 */
function qrOriginOf(req, secure, publicHostnames) {
	const host = typeof req.headers.host === "string" ? req.headers.host : "localhost";
	const hostname = host.replace(/:\d+$/, "").replace(/^\[/, "").replace(/\]$/, "");
	const loopback = hostname === "localhost" || hostname === "::1" || /^127\./.test(hostname);
	if (loopback && Array.isArray(publicHostnames) && publicHostnames.length > 0) {
		return `https://${publicHostnames[0]}`;
	}
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
	// Service worker отдаём сами: браузер запрашивает его без страницы, и он
	// должен быть доступен до входа. Файл статический и ничего не раскрывает.
	if (url.pathname === SERVICE_WORKER_PATH && (req.method === "GET" || req.method === "HEAD")) {
		res.writeHead(200, {
			"content-type": "application/javascript; charset=utf-8",
			"cache-control": "no-cache",
			"service-worker-allowed": "/"
		});
		res.end(req.method === "HEAD" ? void 0 : SERVICE_WORKER_SOURCE);
		return;
	}
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
		qrOrigin: qrOriginOf(req, policy.secure, runtime.config.publicHostnames),
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
//#region lib/types/state.js
// 16-state.js — файл состояния relay.
/** On-disk format version; a file stamped with anything else is refused. */
const STATE_VERSION = 1;
/** File name under the relay state directory. */
const STATE_FILE = "state.json";
/** Owner-only permissions for every file this module writes. */
const SECRET_MODE$1 = 384;
/** A fresh state with a new signing key and nothing enrolled. */
function emptyState() {
	return {
		version: STATE_VERSION,
		signingKey: randomBytes(32).toString("base64url"),
		devices: {},
		grants: {}
	};
}
/**
* The relay's state file.
*
* Reads are synchronous against the in-memory copy loaded at open. Every
* mutation goes through {@link update}, which applies the change in memory and
* persists the whole file before resolving, so an awaited mutation is durable.
*/
var RelayStore = class RelayStore {
	file;
	#state;
	#chain = Promise.resolve();
	#closed = false;
	constructor(file, state) {
		this.file = file;
		this.#state = state;
	}
	/**
	* Load the state file, creating it when absent.
	* @param dir - the relay state directory; created with owner-only permissions.
	* @returns the open store.
	* @throws {Error} when the file exists but is unparsable or carries another format version — a
	* corrupt credential store must fail loud rather than silently reset to "no password set".
	*/
	static async open(dir) {
		await mkdir(dir, {
			recursive: true,
			mode: 448
		});
		const file = join(dir, STATE_FILE);
		let state;
		try {
			const raw = await readFile(file, "utf8");
			const parsed = JSON.parse(raw);
			if (parsed.version !== STATE_VERSION) throw new Error(`dsh-relay: ${file} has format version ${String(parsed.version)}, expected ${String(STATE_VERSION)}`);
			state = {
				...parsed,
				devices: parsed.devices ?? {},
				grants: parsed.grants ?? {}
			};
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			state = emptyState();
			await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, { mode: SECRET_MODE$1 });
		}
		return new RelayStore(file, state);
	}
	/**
	* Current state, synchronously from memory.
	* @returns the live state object; treat it as read-only and mutate through {@link update}.
	*/
	get state() {
		return this.#state;
	}
	/**
	* Apply one mutation and persist the result.
	* @param mutate - synchronous transform over a draft copy of the state.
	* @returns resolution after the new state is on disk.
	*/
	async update(mutate) {
		const task = this.#chain.then(async () => {
			if (this.#closed) throw new Error("dsh-relay: state store is closed");
			const draft = structuredClone(this.#state);
			mutate(draft);
			const temp = `${this.file}.${randomBytes(6).toString("hex")}.tmp`;
			await writeFile(temp, `${JSON.stringify(draft, null, 2)}\n`, { mode: SECRET_MODE$1 });
			await rename(temp, this.file);
			this.#state = draft;
		});
		this.#chain = task.then(() => void 0, () => void 0);
		return task;
	}
	/**
	* Drain queued writes and refuse further ones.
	* @returns resolution after the last queued write has landed.
	*/
	async close() {
		const drained = this.#chain;
		this.#closed = true;
		await drained;
	}
};

//#endregion
//#region lib/types/tls.js
// 17-tls.js — самоподписанный сертификат и его отпечаток.
/** Owner-only permissions. A no-op on Windows — see {@link loadCertificate}. */
const SECRET_MODE = 384;
/** File name of the generated certificate. */
const CERT_FILE = "relay-cert.pem";
/** File name of the generated private key. */
const KEY_FILE = "relay-key.pem";
/** How long a generated certificate stays valid. */
const VALIDITY_DAYS = 825;
/** subjectAltName type codes from RFC 5280, as `selfsigned` spells them. */
const SAN_DNS = 2;
const SAN_IP = 7;
/**
* SHA-256 of a certificate's DER SubjectPublicKeyInfo, base64.
*
* This is the value a pinning client compares, and it is deliberately the
* public key rather than the whole certificate: renewing with the same key
* then leaves every paired device working.
* @param certPem - the certificate, PEM encoded.
* @returns the base64 digest.
*/
function spkiFingerprint(certPem) {
	const spki = new X509Certificate(certPem).publicKey.export({
		type: "spki",
		format: "der"
	});
	return createHash("sha256").update(spki).digest("base64");
}
/**
* The names a generated certificate must cover.
* @param publicHostnames - names a forwarded deployment is reached by.
* @returns DNS names and IP literals, deduplicated.
*/
function certificateSans(publicHostnames) {
	return [...new Set([
		"localhost",
		"127.0.0.1",
		...localAddresses(),
		...publicHostnames
	])];
}
/**
* Generate a certificate and write it beside the state file.
* @param dir - the relay state directory.
* @param sans - subject alternative names to cover.
* @returns the generated material.
*/
async function generate(dir, sans) {
	const { default: selfsigned } = await import("selfsigned");
	const notBefore = /* @__PURE__ */ new Date();
	const notAfter = new Date(notBefore.getTime() + VALIDITY_DAYS * 864e5);
	const pems = await selfsigned.generate([{
		name: "commonName",
		value: "dsh-relay"
	}], {
		keyType: "ec",
		curve: "P-256",
		algorithm: "sha256",
		notBeforeDate: notBefore,
		notAfterDate: notAfter,
		extensions: [
			{
				name: "basicConstraints",
				cA: false,
				critical: true
			},
			{
				name: "keyUsage",
				digitalSignature: true,
				keyEncipherment: true,
				critical: true
			},
			{
				name: "extKeyUsage",
				serverAuth: true
			},
			{
				name: "subjectAltName",
				altNames: sans.map((value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value) ? {
					type: SAN_IP,
					ip: value
				} : {
					type: SAN_DNS,
					value
				})
			}
		]
	});
	await mkdir(dir, {
		recursive: true,
		mode: 448
	});
	await writeFile(join(dir, CERT_FILE), pems.cert, { mode: SECRET_MODE });
	await writeFile(join(dir, KEY_FILE), pems.private, { mode: SECRET_MODE });
	return {
		cert: pems.cert,
		key: pems.private,
		record: {
			fingerprint: spkiFingerprint(pems.cert),
			sans: [...sans],
			generatedAt: notBefore.getTime(),
			expiresAt: notAfter.getTime()
		}
	};
}
/**
* Load the certificate for the configured posture, generating one if needed.
*
* A generated certificate is regenerated when it has expired or when the set
* of addresses it covers has changed — a laptop that moved networks would
* otherwise present a certificate naming an address it no longer has.
*
* The private key is written mode 0600. **That is a no-op on Windows**, where
* the file inherits the ACL of the harness home directory; a deployment that
* shares that directory should restrict it with `icacls` or point `tls` at
* files it manages itself.
* @param options.mode - the configured posture; `off` returns undefined.
* @param options.dir - the relay state directory.
* @param options.certPath - operator-supplied certificate, for `files`.
* @param options.keyPath - operator-supplied key, for `files`.
* @param options.sans - names a generated certificate must cover.
* @param options.existing - the certificate record from durable state, if any.
* @returns the material to hand `https.createServer`, or undefined for plaintext.
*/
async function loadCertificate(options) {
	if (options.mode === "off") return void 0;
	if (options.mode === "files") {
		const [cert, key] = await Promise.all([readFile(options.certPath, "utf8"), readFile(options.keyPath, "utf8")]);
		const parsed = new X509Certificate(cert);
		return {
			cert,
			key,
			record: {
				fingerprint: spkiFingerprint(cert),
				sans: [...options.sans],
				generatedAt: Date.parse(parsed.validFrom),
				expiresAt: Date.parse(parsed.validTo)
			}
		};
	}
	const wanted = [...options.sans].toSorted().join(",");
	const covered = options.existing !== void 0 && [...options.existing.sans].toSorted().join(",") === wanted;
	if (options.existing !== void 0 && covered && Date.now() < options.existing.expiresAt) try {
		const [cert, key] = await Promise.all([readFile(join(options.dir, CERT_FILE), "utf8"), readFile(join(options.dir, KEY_FILE), "utf8")]);
		await chmod(join(options.dir, KEY_FILE), SECRET_MODE).catch(() => void 0);
		return {
			cert,
			key,
			record: options.existing
		};
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	return generate(options.dir, options.sans);
}

//#endregion
//#region lib/types/index.js
// 18-index.js — плагин целиком: Config, apply и надзор за слушателями.
/** Stable Cordis plugin name. */
const name = "relay";
/** The harness web server this relay fronts. */
const inject = ["webServer"];
/**
* The plugin object the Cordis loader registers, and the only reason this
* module has a default export.
*
* The loader normalizes a module's exports down to a single plugin object —
* `unwrapExports` is `exports.default ?? exports` — and then caches the
* configuration schema off **that** object, as `{ name, callback, fibers,
* Config: plugin.Config }`. The harness's settings plane reads it back with
* `entry.fiber.runtime.Config` to decide whether an entry is an editable
* namespace at all.
*
* A module that exports a bare `apply` **function** therefore has no `.Config`
* for anyone to find, and its entry is invisible to the Plugins page no matter
* how correct the rest is: the Host serves no namespace, and the browser card
* has nothing to attach to. Verified against dsh 0.1.7-rc.2, where this plugin
* with only the named exports contributes **zero** namespaces to
* `settings/describe`.
*/
var types_default = {
	name,
	inject,
	apply,
	Config
};
/** The relay's own logging, degraded to the console when no logger is mounted. */
function loggerFor(ctx) {
	const logger = ctx.get("logger");
	return {
		info: (message) => void (logger?.info?.(`[dsh-relay] ${message}`) ?? console.log(`[dsh-relay] ${message}`)),
		warn: (message) => void (logger?.warn?.(`[dsh-relay] ${message}`) ?? console.warn(`[dsh-relay] ${message}`))
	};
}
/**
* Mount the relay.
* @param ctx - plugin context; `ctx.webServer` is the harness listener to front.
* @param config - resolved configuration.
*/
function apply(ctx, config) {
	const initial = plainConfig(config);
	assertCoherent(initial);
	for (const entry of [...initial.trustedHosts, ...initial.publicHostnames]) assertTrustedAuthority(entry);
	if (ctx.webServer.host === "0.0.0.0") throw new Error("dsh-relay: the harness web server is bound to 0.0.0.0, so it is already reachable without authentication and this relay would protect nothing. Remove the webserver row override that sets host: 0.0.0.0 (the DSH Mobile LAN patch) and restart.");
	const log = loggerFor(ctx);
	ctx.effect(() => {
		const supervisor = new Supervisor(ctx, log);
		const read = () => plainConfig(config);
		followSettings(ctx, { onChange: () => {
			supervisor.apply(read());
		} });
		supervisor.apply(read());
		return async () => {
			await supervisor.stop();
		};
	}, "dsh-relay: listeners");
}
/**
* Keeps exactly one relay running across configuration changes.
*
* A settings edit replaces the whole resolved configuration, including the
* listen ports, so the response is to tear the listeners down and bind again.
* Every transition runs on one chain: overlapping edits would otherwise race
* to bind the same port, and re-listening before the previous close has
* settled fails with EADDRINUSE. A generation counter lets a superseded
* transition drop out instead of starting a relay nobody asked for.
*/
var Supervisor = class {
	ctx;
	log;
	#generation = 0;
	#chain = Promise.resolve();
	#running;
	#applied;
	/**
	* @param ctx - the plugin context passed through to each launch.
	* @param log - the relay's logging.
	*/
	constructor(ctx, log) {
		this.ctx = ctx;
		this.log = log;
	}
	/**
	* Run the relay under a new configuration, replacing any current one.
	*
	* An unusable configuration leaves the running relay alone rather than
	* taking it down: a typo in a settings form should not cost the operator
	* their remote access until they can reach the machine to fix it.
	* @param config - the newly resolved configuration.
	*/
	apply(config) {
		try {
			assertCoherent(config);
		} catch (error) {
			this.log.warn(`ignoring an unusable configuration, keeping the running one: ${String(error)}`);
			return;
		}
		const fingerprint = JSON.stringify(config);
		if (fingerprint === this.#applied) return;
		this.#applied = fingerprint;
		const mine = ++this.#generation;
		this.#chain = this.#chain.then(async () => {
			if (mine !== this.#generation) return;
			await this.#running?.stop();
			this.#running = void 0;
			if (mine !== this.#generation) return;
			try {
				this.#running = await start(this.ctx, config, this.log);
			} catch (error) {
				this.log.warn(`failed to start: ${String(error)}`);
			}
		}, () => void 0);
	}
	/**
	* Stop for good.
	* @returns resolution once the last transition has settled and the listeners are closed.
	*/
	async stop() {
		this.#generation += 1;
		await this.#chain;
		await this.#running?.stop();
		this.#running = void 0;
	}
};
/**
* Open the state store, load the certificate, and bind the listeners.
* @param ctx - plugin context.
* @param config - resolved configuration.
* @param log - the relay's logging.
* @returns the running relay.
*/
async function start(ctx, config, log) {
	const dir = relayStateDir(ctx, config.stateDir);
	const store = await RelayStore.open(dir);
	const auth = new Authenticator(store, config);
	const sans = certificateSans(config.publicHostnames);
	const material = await loadCertificate({
		mode: config.tls,
		dir,
		certPath: config.tlsCertPath,
		keyPath: config.tlsKeyPath,
		sans,
		existing: store.state.certificate
	});
	if (material !== void 0 && material.record.fingerprint !== store.state.certificate?.fingerprint) await store.update((draft) => {
		draft.certificate = material.record;
	});
	const resolver = HarnessSession.lazy(ctx);
	await resolver.current();
	if (!resolver.ready) log.info("no harness browser-session secret yet; forwarding unauthenticated until it appears. That is correct for a harness before 0.1.2. On 0.1.2 or later the harness writes that secret once it has started, and the relay picks it up on the next request without a reload.");
	const runtime = {
		auth,
		config,
		target: {
			host: "127.0.0.1",
			port: ctx.webServer.port,
			timeoutMs: config.proxyTimeoutMs,
			session: () => resolver.sync()
		},
		fingerprint: material?.record.fingerprint,
		log: (message) => {
			log.warn(message);
		}
	};
	const poll = setInterval(() => {
		if (resolver.ready) {
			clearInterval(poll);
			if (resolver.markRecovered()) log.info("harness browser session is available; proxied requests now authenticate");
			return;
		}
		resolver.current();
	}, 1e3);
	poll.unref?.();
	const authorities = relayAuthorities(config);
	const primary = await startListener({
		runtime,
		bind: config.bind,
		port: config.port,
		tls: material,
		authorities
	});
	const compat = config.compat.plainPort === 0 ? void 0 : await startListener({
		runtime,
		bind: config.bind,
		port: config.compat.plainPort,
		compat: true,
		authorities
	});
	if (compat !== void 0) runtime.plainPort = compat.port;
	const scheme = material === void 0 ? "http" : "https";
	const unroute = ctx.webServer.register({
		kind: "prefix",
		path: RELAY_PREFIX,
		handler: (req, res) => {
			const target = `${scheme}://${(typeof req.headers.host === "string" ? req.headers.host : "127.0.0.1").replace(/:\d+$/, "")}:${String(primary.port)}${req.url ?? RELAY_PREFIX}`;
			res.writeHead(302, {
				location: target,
				"cache-control": "no-store"
			});
			res.end();
		}
	});
	const untap = config.uiLink ? ctx.webServer.tapIndex(injectRelayLink) : () => void 0;
	const untapShim = ctx.webServer.tapIndex(injectSecureContextShim);
	// Регистрация service worker: кэш ассетов переживает очистку HTTP-кэша
	// браузером, поэтому повторный вход на телефоне не тянет 470 КБ заново.
	const untapServiceWorker = ctx.webServer.tapIndex(injectServiceWorker);
	// Адрес в консоль не печатаем: ссылки relay не нужны.
	if (material === void 0) log.warn("serving plaintext: anything on the network path can read this traffic and the credentials on it");
	if (compat !== void 0) log.warn(`plain compatibility listener on port ${String(compat.port)}: DSH Mobile 0.5.0 only, no configuration access`);
	if (!auth.hasPassword) log.info('Пароль ещё не задан — задайте его в настройках Mobile UI.');
	const unadvertise = config.mdns ? await advertise({
		port: primary.port,
		plainPort: compat?.port,
		tls: config.tls,
		fingerprint: material?.record.fingerprint,
		name: config.mdnsName
	}, (message) => {
		log.warn(message);
	}) : async () => void 0;
	return { stop: async () => {
		clearInterval(poll);
		untapServiceWorker();
		untapShim();
		untap();
		unroute();
		await unadvertise();
		await compat?.close();
		await primary.close();
		auth.dispose();
		await store.close();
	} };
}

//#endregion
export { Config, apply, types_default as default, inject, name, plainConfig };
