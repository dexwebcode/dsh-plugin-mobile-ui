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
