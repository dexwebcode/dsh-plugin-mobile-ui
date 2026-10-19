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
		// Считаем кадры, уходящие клиенту: чат и есть основной трафик.
		usageCountSocket(socket);
		upstreamSocket.pipe(socket);
		socket.pipe(upstreamSocket);
	});
	upstream.end();
}

//#endregion
