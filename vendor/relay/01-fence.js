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
