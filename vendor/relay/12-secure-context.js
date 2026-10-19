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
// тому же вычищают HTTP-кэш за неделю — телефон качает всё заново, выжигая
// лимит ngrok.
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
