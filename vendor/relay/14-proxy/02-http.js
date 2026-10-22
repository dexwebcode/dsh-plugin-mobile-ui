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
