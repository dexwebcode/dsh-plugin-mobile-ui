// usage.js — расход трафика ngrok: накопительный учёт и маршрут для браузера.
//
// Relay считает байты, которые отдаёт клиентам (`vendor/relay/00-usage.js`),
// но его счётчик живёт в памяти и обнуляется вместе с процессом. Здесь этот
// счётчик опрашивается и складывается в файл по аккаунтам и месяцам — ровно та
// величина, которую ngrok списывает с лимита (1 ГБ на бесплатном плане).
//
// Аккаунт определяется токеном: в файл попадает только его хэш, сами токены
// никуда не сохраняются. Ключ месяца совпадает с календарным месяцем: у ngrok
// квота обновляется первого числа.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { request } from 'node:https'
import { dshHome } from '../../vendor/tunnel/runtime.js'
import { accountName, parseNames, parseTokens, readActiveIndex, readConfiguredNames, readConfiguredTokens } from './ngrok-accounts.js'
import { readJsonBody, sendJson } from './http.js'

/** Путь маршрута, по которому браузер узнаёт расход. */
const USAGE_PATH = '/mobile-ui/usage'

/** Файл накопительной статистики. */
const STATE_FILE = 'ngrok-usage.json'

/** Как часто снимать счётчик relay. */
const POLL_MS = 30000

/** Сколько ждать ответа relay. */
const RELAY_TIMEOUT_MS = 5000

/** Месячный лимит бесплатного ngrok, если настройка не задана. */
const DEFAULT_LIMIT_BYTES = 1024 * 1024 * 1024

/**
 * Ключ месяца в том же виде, в каком его обновляет ngrok.
 * @param date - дата, по умолчанию текущая.
 * @returns `YYYY-MM`.
 */
export function monthKey(date = new Date()) {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Стабильный ключ аккаунта: хэш токена, а не сам токен.
 * @param token - authtoken ngrok.
 * @returns короткий hex-хэш.
 */
function tokenKey(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/** Прочитать накопительное состояние. */
function readState() {
  try {
    const data = JSON.parse(readFileSync(join(dshHome(), STATE_FILE), 'utf8'))
    return data !== null && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

/** Записать накопительное состояние. */
function writeState(state) {
  try {
    writeFileSync(join(dshHome(), STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.warn(`dsh-mobile-ui: could not save the ngrok usage: ${String(error)}`)
  }
}

/**
 * Спросить relay, сколько он отдал с момента запуска.
 * @param port - порт relay.
 * @returns `{ bytes, since }` или undefined, если relay не ответил.
 */
function probeRelay(port) {
  return new Promise((resolve) => {
    let call
    try {
      call = request({
        host: '127.0.0.1',
        port,
        path: '/relay/usage.json',
        method: 'GET',
        rejectUnauthorized: false,
        timeout: RELAY_TIMEOUT_MS,
        headers: { accept: 'application/json' },
      }, (response) => {
        const chunks = []
        response.on('data', (chunk) => { chunks.push(chunk) })
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch {
            resolve(undefined)
          }
        })
        response.on('error', () => { resolve(undefined) })
      })
    } catch {
      resolve(undefined)
      return
    }
    call.on('timeout', () => { call.destroy(new Error('timeout')) })
    call.on('error', () => { resolve(undefined) })
    call.end()
  })
}

/**
 * Активный токен и его позиция в пуле.
 * @param config - разрешённая конфигурация строки.
 * @returns токен (или undefined), номер с единицы и размер пула.
 */
function activeAccount(config) {
  const tokens = parseTokens(readConfiguredTokens(config))
  if (tokens.length === 0) return { token: undefined, index: 0, total: 0 }
  const index = Math.min(readActiveIndex(), tokens.length - 1)
  return { token: tokens[index], index, total: tokens.length }
}

/**
 * Собрать расход для браузера.
 *
 * `measured` — что насчитал relay, `offset` — поправка, которую человек ввёл
 * вручную по кабинету ngrok, `used` — их сумма. Поправка нужна потому, что наш
 * счётчик не видит байты самого ngrok (страница-предупреждение, страницы ошибок)
 * и трафик других проектов на том же аккаунте.
 *
 * @param config - разрешённая конфигурация строки.
 * @returns использовано, измерено, поправка, лимит, остаток, доля и имя аккаунта.
 */
export function collectUsage(config) {
  const account = activeAccount(config)
  const names = parseNames(readConfiguredNames(config))
  const configured = Number(config?.ngrokMonthlyLimitBytes ?? 0)
  const limit = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_LIMIT_BYTES
  const month = monthKey()
  let measured = 0
  let offset = 0
  if (account.token !== undefined) {
    const state = readState()
    const entry = state.accounts?.[tokenKey(account.token)]
    if (entry !== undefined && entry.month === month) {
      if (Number.isFinite(entry.bytes)) measured = entry.bytes
      if (Number.isFinite(entry.offset)) offset = entry.offset
    }
  }
  const used = Math.max(0, measured + offset)
  return {
    used,
    measured,
    offset,
    limit,
    remaining: Math.max(0, limit - used),
    ratio: limit > 0 ? Math.min(1, used / limit) : 0,
    account: account.total === 0 ? 0 : account.index + 1,
    accounts: account.total,
    name: accountName(names, account.index),
    month,
  }
}

/**
 * Записать актуальное значение из кабинета ngrok.
 *
 * Человек вводит число, которое видит в кабинете; поправка считается как
 * разница с измеренным, поэтому дальше счётчик продолжает расти от него.
 *
 * @param config - разрешённая конфигурация строки.
 * @param actual - сколько байт показывает кабинет.
 * @returns признак успеха.
 */
export function setActualUsage(config, actual) {
  const account = activeAccount(config)
  if (account.token === undefined) return { ok: false, error: 'no-account' }
  const value = Number(actual)
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'bad-value' }

  const month = monthKey()
  const state = readState()
  const accounts = state.accounts !== null && typeof state.accounts === 'object' ? state.accounts : {}
  const key = tokenKey(account.token)
  const previous = accounts[key]
  const measured = previous !== undefined && previous.month === month && Number.isFinite(previous.bytes) ? previous.bytes : 0
  accounts[key] = {
    month,
    bytes: measured,
    offset: Math.round(value) - measured,
    updatedAt: Date.now(),
  }
  state.accounts = accounts
  writeState(state)
  return { ok: true }
}

/**
 * Вести учёт расхода и отдавать его браузеру.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installUsage(ctx, config) {
  ctx.effect(() => {
    /** Счётчик relay на прошлом шаге: по разнице получаем приращение. */
    let lastSince = 0
    let lastBytes = 0
    let disposed = false

    /** Снять счётчик и добавить приращение активному аккаунту. */
    const tick = async () => {
      if (disposed) return
      const sampled = await probeRelay(Number(config?.relayPort ?? 3443))
      if (disposed || sampled === undefined || !Number.isFinite(sampled.bytes)) return
      const account = activeAccount(config)
      if (account.token === undefined) return
      const since = Number(sampled.since) || 0
      const bytes = sampled.bytes
      // relay перезапустился — его счётчик начался заново, берём всё значение.
      const delta = since === lastSince ? Math.max(0, bytes - lastBytes) : bytes
      lastSince = since
      lastBytes = bytes
      if (delta <= 0) return

      const month = monthKey()
      const state = readState()
      const accounts = state.accounts !== null && typeof state.accounts === 'object' ? state.accounts : {}
      const key = tokenKey(account.token)
      const previous = accounts[key]
      const carried = previous !== undefined && previous.month === month && Number.isFinite(previous.bytes) ? previous.bytes : 0
      // Поправку, введённую по кабинету, приращение не сбрасывает.
      const carriedOffset = previous !== undefined && previous.month === month && Number.isFinite(previous.offset) ? previous.offset : 0
      accounts[key] = { month, bytes: carried + delta, offset: carriedOffset, updatedAt: Date.now() }
      state.accounts = accounts
      writeState(state)
    }

    void tick()
    const timer = setInterval(() => { void tick() }, POLL_MS)
    if (typeof timer.unref === 'function') timer.unref()
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, 'dsh-mobile-ui: ngrok usage')

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: USAGE_PATH,
    handler: async (req, res) => {
      if ((req.method ?? 'GET').toUpperCase() === 'POST') {
        const body = await readJsonBody(req)
        if (body === undefined || body.bytes === undefined) {
          sendJson(res, 400, { ok: false, error: 'bad-request' })
          return
        }
        const result = setActualUsage(config, body.bytes)
        sendJson(res, result.ok ? 200 : 400, result)
        return
      }
      sendJson(res, 200, collectUsage(config))
    },
  }), 'dsh-mobile-ui: usage route')
}
