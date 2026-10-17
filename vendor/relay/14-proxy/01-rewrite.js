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
