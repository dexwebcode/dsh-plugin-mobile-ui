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
