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
