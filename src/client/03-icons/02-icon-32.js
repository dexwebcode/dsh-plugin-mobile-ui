// 03-icons/02-icon-32.js — иконка 32px (фавикон и ярлык).
// Data URL, а не файл: статическая раздача harness не знает расширения .png и
// отдаёт такие файлы как application/octet-stream — Chrome иконку с чужим типом
// для установки не принимает. В data URL тип image/png прописан явно.
/**
 * Иконки приложения как data URL.
 *
 * Копии файлов лежат и в каталоге собранного интерфейса, но в манифест идут
 * именно data URL: статическая раздача harness не знает расширения `.png` и
 * отдаёт такие файлы как `application/octet-stream`, а Chrome иконку с чужим
 * типом для установки не принимает. В data URL тип `image/png` прописан
 * явно, и проверка проходит.
 *
 * Значения подставляет `embed-icons.mjs` из `icons/*.png` — base64 в исходнике
 * руками не правится.
 */
const APP_ICON_32 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAC5klEQVR4nOxWSUtyYRS+VlBBFBUNUNFAFLSKCKKBICgqgtoU1CbaFAQt2lWLin5BIYoIgigudOMEgoIbUQTBAdzpxllRRBFncfie77tw0ZtTi+BbeBaX+5573vO85zzPebk9lUqF+E3rIn7ZOgAdgOamVCpbxjAazYHX69VqtXjifX5+3uFwWCwWq9XK4XDOz8/hTCaTY2NjBoNhfX2d2oVssVhsdHS0GUAqlXp4eBAKhd8/dXd3B4PB8fFxvLtcroWFhf7+/re3t+fnZ+S12+1yuXxoaOjj44Pa0kNLkc/nDw8PjUYjUc9KpdLBwYFKpZqenp6cnOzt7c1msy8vL5FI5OvrizyQSCSq3kLn4PX1tVF20nDMnZ0dt9uNs9/e3pLOz89PMvvExMTZ2Vl1fE2LQqEQjlYul4lWNjs7i+4PDAxcXl5qNBrSube3x2KxVlZWqiNrWoTakf3k5AS8BQIBvV4PbusCeDwe1CEWi0E4AObm5oA3NTX1PbIGwOl0gkaIr6vrb+tQnEAgAIHhcJiKubu729raenp6Asbm5ibpBNt1sxM0DjKZDGhEf8klg8G4ublBEaenp1QMxAr96HS6wcFBykkhtQAARXjabLZqJ2QH8QGJAjCZTMvLy5ANFXN8fNwWwOrqKp5sNpsWhFJ4PN7+/j65VKvVaBSTySSXi4uLaFojgBoVYcRQBBoFxra3t2mhfr8fCsEA0/zQ6OPjI9FOBZAdKe2Li4toNEo6i8Ui2oIXKJjL5dL2Ly0t3d/fE42NPmjv7+8zMzMYCLQV8wlPLpfb3d2F3n0+39XVFTVcMEwybhQ8fwAwPDwsk8lQitlsXltbA594x+UhkUg2NjagKDBEkYHuJxIJnKAJQP3bFBxAmvF4nObv6+u7vr7GZalQKDAH6XQaTgiMz+f/DID4N6uYJlRTKBRon46OjpARlx3RhjGa/xdBM1KpFJNFLkdGRpAdxBJtG6Pz49UB+P8B/gAAAP//WgQ6QgAAAAZJREFUAwDQ/16E4EPR+QAAAABJRU5ErkJggg=='
