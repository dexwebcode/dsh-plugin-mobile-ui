// 00-usage.js — счётчик исходящего трафика relay.
//
// ПРАВКА ВЕНДОРА (локально). Зачем: у бесплатного ngrok 1 ГБ исходящего трафика
// в месяц, и упереться в него можно молча — ngrok просто перестаёт отдавать
// страницу (ERR_NGROK_725), а агент при этом жив. Relay видит ровно тот трафик,
// который потом уходит в туннель, поэтому считаем здесь: каждый байт,
// записанный клиенту, плюс кадры websocket. Счётчик живёт в памяти процесса и
// начинается заново вместе с relay; накопительную статистику по месяцам ведёт
// host-половина плагина (`src/host/usage.js`).
var USAGE_BYTES = 0;
var USAGE_SINCE = Date.now();
/**
* Учесть отправленные клиенту байты.
* @param size - byte length of the chunk.
*/
function usageAdd(size) {
	if (Number.isFinite(size) && size > 0) USAGE_BYTES += size;
}
/**
* Считать байты, которые обработчик пишет в ответ.
*
* Оборачиваем `write`/`end`, а не `writeHead`: заголовки в лимит ngrok не идут,
* а тело — идёт целиком.
* @param res - the response to instrument.
* @returns the same response.
*/
function usageCountResponse(res) {
	const write = res.write.bind(res);
	const end = res.end.bind(res);
	res.write = (chunk, ...rest) => {
		if (chunk !== void 0 && chunk !== null && typeof chunk !== "function") usageAdd(Buffer.byteLength(chunk));
		return write(chunk, ...rest);
	};
	res.end = (chunk, ...rest) => {
		if (chunk !== void 0 && chunk !== null && typeof chunk !== "function") usageAdd(Buffer.byteLength(chunk));
		return end(chunk, ...rest);
	};
	return res;
}
/**
* Считать байты, которые уходят в websocket.
* @param socket - the client-side socket.
* @returns the same socket.
*/
function usageCountSocket(socket) {
	const write = socket.write.bind(socket);
	socket.write = (chunk, ...rest) => {
		if (chunk !== void 0 && chunk !== null && typeof chunk !== "function") usageAdd(Buffer.byteLength(chunk));
		return write(chunk, ...rest);
	};
	return socket;
}
