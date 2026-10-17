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
