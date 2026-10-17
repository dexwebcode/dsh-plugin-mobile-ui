// http.js — мелкие помощники для маршрутов host-половины.
/** Предел принимаемого тела запроса: сюда приходит только пароль. */
const MAX_BODY_BYTES = 8192

/**
 * Ответить браузеру данными в JSON.
 * @param res - ответ, которым маршрут владеет целиком.
 * @param status - код ответа.
 * @param data - то, что нужно отдать.
 */
export function sendJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

/**
 * Прочитать тело запроса как JSON-объект.
 * @param req - входящий запрос.
 * @returns разобранный объект, либо `undefined` для пустого или битого тела.
 */
export function readJsonBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        resolve(undefined)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text === '') {
        resolve(undefined)
        return
      }
      try {
        const data = JSON.parse(text)
        resolve(data !== null && typeof data === 'object' ? data : undefined)
      } catch {
        resolve(undefined)
      }
    })
    req.on('error', () => { resolve(undefined) })
  })
}
