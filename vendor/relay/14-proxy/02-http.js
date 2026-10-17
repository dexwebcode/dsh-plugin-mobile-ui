//#region lib/types/proxy/http.js
// 02-http.js — проксирование обычных запросов.
/** The authority the harness sees, and compares its own fence against. */
function loopbackAuthority(target) {
	return `${target.host}:${String(target.port)}`;
}
/**
* Forward one request and stream its response back.
* @param req - the inbound request; its body is piped upstream.
* @param res - the response to write; owned entirely by this call.
* @param target - the loopback harness.
* @returns resolution once the response is finished or an error was reported.
*/
function forward(req, res, target) {
	return new Promise((resolve$1) => {
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
			res.writeHead(upstreamRes.statusCode ?? 502, downstreamHeaders(upstreamRes.headers));
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
		});
		req.on("error", () => {
			upstream.destroy();
		});
		req.pipe(upstream);
	});
}

//#endregion
