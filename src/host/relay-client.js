// relay-client.js — обращения к вшитому relay по петлевому адресу.
//
// Приглашение для телефона и смена пароля живут внутри relay, а раздел настроек
// работает в браузере на другом origin. Мост — эти вызовы: плагин ходит к relay
// как обычный клиент с 127.0.0.1, где relay считает его оператором.
//
// Сертификат relay самоподписанный, поэтому проверка цепочки отключена: канал
// не покидает петлевой интерфейс.
import { request } from 'node:https'

/** Сколько ждать ответа relay, прежде чем считать его недоступным. */
const TIMEOUT_MS = 5000

/**
 * Сходить в relay за петлевой адрес.
 * @param port - порт, на котором слушает relay.
 * @param path - путь запроса вместе с ведущей косой чертой.
 * @param options - метод, заголовки и тело запроса.
 * @returns код ответа и тело в виде текста.
 */
function relayRequest(port, path, options = {}) {
  return new Promise((resolve, reject) => {
    const call = request({
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      rejectUnauthorized: false,
      timeout: TIMEOUT_MS,
    }, (response) => {
      const chunks = []
      response.on('data', (chunk) => { chunks.push(chunk) })
      response.on('end', () => {
        resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
      })
    })
    call.on('timeout', () => { call.destroy(new Error('relay did not answer in time')) })
    call.on('error', reject)
    if (options.body !== undefined) call.write(options.body)
    call.end()
  })
}

/**
 * Запросить у relay приглашение для телефона: QR и одноразовый код.
 * @param port - порт relay.
 * @returns приглашение или `undefined`, если relay не ответил.
 */
export async function fetchInvitation(port) {
  try {
    const answer = await relayRequest(port, '/relay/pair.json', {
      headers: { accept: 'application/json' },
    })
    if (answer.status !== 200) return undefined
    const data = JSON.parse(answer.body)
    return data !== null && typeof data === 'object' ? data : undefined
  } catch {
    return undefined
  }
}

/**
 * Выпустить в relay новый код, обесценив предыдущий.
 * @param port - порт relay.
 * @returns true, если relay принял запрос.
 */
export async function requestNewCode(port) {
  try {
    const answer = await relayRequest(port, '/relay/pair/new', { method: 'POST' })
    return answer.status < 400
  } catch {
    return false
  }
}

/**
 * Сменить пароль на вход.
 *
 * Проверки длины и совпадения повторяют правила relay, чтобы человек получил
 * понятный ответ, не дожидаясь отказа: relay отвечает на ошибку HTML-страницей.
 *
 * @param port - порт relay.
 * @param password - новый пароль.
 * @param confirm - повтор пароля.
 * @returns результат с признаком успеха и текстом для человека.
 */
export async function changePassword(port, password, confirm) {
  if (typeof password !== 'string' || password.length < 10) {
    return { ok: false, message: 'Пароль короче 10 символов.' }
  }
  if (password !== confirm) {
    return { ok: false, message: 'Пароли не совпадают.' }
  }
  try {
    const answer = await relayRequest(port, '/relay/password', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ password, confirm }).toString(),
    })
    if (answer.status === 200) return { ok: true, message: 'Пароль изменён.' }
    if (answer.status === 400) return { ok: false, message: 'Relay отклонил пароль: минимум 10 символов.' }
    if (answer.status === 403) return { ok: false, message: 'Сменить пароль можно только с этой машины.' }
    return { ok: false, message: `Relay ответил кодом ${String(answer.status)}.` }
  } catch {
    return { ok: false, message: 'Relay не отвечает — проверьте, что он запущен.' }
  }
}
