// ngrok-accounts.js — пул ngrok-аккаунтов: активный токен и переключение по лимиту.
//
// У бесплатного ngrok на аккаунт 1 ГБ трафика в месяц. Когда он кончается, ngrok
// отдаёт на публичный адрес страницу ERR_NGROK_725, хотя сам агент жив: он
// подключён, туннель поднят, и сторож считает его здоровым. Переключиться агент
// не умеет — значит это делает host-половина: держит список токенов, помнит
// активный и, увидев 725, переводит туннель на следующий аккаунт.
//
// Список токенов приходит из той же настройки, что и раньше: поле «Токен ngrok»
// принимает несколько токенов через запятую, точку с запятой, пробел или перевод
// строки. Активный аккаунт запоминается в `$DSH_HOME/ngrok-accounts.json`, чтобы
// после перезапуска harness не возвращаться на исчерпанный.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { request } from 'node:https'
import { dshHome } from '../../vendor/tunnel/runtime.js'
import { restartTunnel } from '../../vendor/tunnel/supervisor.js'

/** Файл, где запоминается активный аккаунт. */
const STATE_FILE = 'ngrok-accounts.json'

/** Сколько ждать ответа публичного адреса. */
const PROBE_TIMEOUT_MS = 8000

/** Предел читаемого тела при проверке: страница ошибки ngrok маленькая. */
const PROBE_MAX_BYTES = 16384

/** Как часто проверять, не упёрлись ли в лимит. */
const PROBE_INTERVAL_MS = 60000

/** Пауза после переключения: даём новому агенту подняться и не долбим ngrok. */
const AFTER_SWITCH_MS = 90000

/** Приметы исчерпанного лимита в ответе ngrok. */
const LIMIT_MARKERS = ['ERR_NGROK_725', 'ERR_NGROK_702', 'reached its network bandwidth limit']

/** Файл, где помнятся последние публичные адреса аккаунтов. */
const URL_FILE = 'ngrok-urls.json'

/**
 * Список подписей к токенам.
 *
 * Имена хранятся отдельной настройкой в том же порядке, что и токены: так пул
 * остаётся простым списком строк, а подпись — только для человека. Запятая
 * внутри имени заменяется пробелом, иначе разбор поехал бы.
 *
 * @param raw - значение настройки как есть.
 * @returns подписи; пустая строка на месте пропущенной.
 */
export function parseNames(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return []
  return raw.split(',').map((name) => name.trim())
}

/**
 * Имя аккаунта для интерфейса.
 * @param names - результат {@link parseNames}.
 * @param index - номер в списке токенов.
 * @returns подпись или «Аккаунт N».
 */
export function accountName(names, index) {
  const name = Array.isArray(names) ? names[index] : undefined
  return typeof name === 'string' && name !== '' ? name : `Аккаунт ${String(index + 1)}`
}

/**
 * Короткий ключ аккаунта: хэш токена, а не сам токен.
 * @param token - authtoken ngrok.
 * @returns hex-хэш.
 */
export function tokenKey(token) {
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/**
 * Запомнить публичный адрес активного аккаунта.
 *
 * У каждого ngrok-аккаунта свой постоянный домен, но узнать его можно только
 * когда этот аккаунт активен. Поэтому адрес запоминается по мере работы и потом
 * показывается в списке ссылок.
 *
 * @param token - токен активного аккаунта.
 * @param url - публичный адрес или пустая строка.
 */
export function rememberUrl(token, url) {
  if (typeof token !== 'string' || token === '' || typeof url !== 'string' || url === '') return
  const file = join(dshHome(), URL_FILE)
  let state = {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed !== null && typeof parsed === 'object') state = parsed
  } catch {
    state = {}
  }
  const key = tokenKey(token)
  const previous = state[key]
  if (previous !== undefined && previous.url === url) return
  state[key] = { url, at: Date.now() }
  try {
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  } catch {
    // Не смогли записать — не повод ломать выдачу статуса.
  }
}

/**
 * Прочитать запомненные адреса аккаунтов.
 * @returns карта «хэш токена → адрес».
 */
export function readUrlMap() {
  try {
    const parsed = JSON.parse(readFileSync(join(dshHome(), URL_FILE), 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Собрать список аккаунтов с именами и известными адресами.
 * @param config - разрешённая конфигурация строки.
 * @returns записи в порядке пула.
 */
export function accountLinks(config) {
  const tokens = parseTokens(readConfiguredTokens(config))
  const names = parseNames(readConfiguredNames(config))
  const urls = readUrlMap()
  const active = Math.min(readActiveIndex(), Math.max(0, tokens.length - 1))
  return tokens.map((token, index) => {
    const remembered = urls[tokenKey(token)]
    return {
      index,
      name: accountName(names, index),
      url: remembered !== undefined && typeof remembered.url === 'string' ? remembered.url : '',
      active: index === active,
    }
  })
}

/**
 * Разобрать настройку в список токенов.
 *
 * Разделители — запятая, точка с запятой, пробел и перевод строки: человек может
 * вставить и «токен1, токен2», и столбик. Дубликаты убираются, чтобы смена
 * аккаунта не вернулась на тот же самый.
 *
 * @param raw - значение настройки как есть.
 * @returns токены в порядке ввода.
 */
export function parseTokens(raw) {
  if (typeof raw !== 'string') return []
  const seen = new Set()
  const tokens = []
  for (const part of raw.split(/[\s,;]+/)) {
    const token = part.trim()
    if (token === '' || seen.has(token)) continue
    seen.add(token)
    tokens.push(token)
  }
  return tokens
}

/**
 * Индекс активного аккаунта из состояния.
 * @returns номер в списке токенов; 0, если состояния ещё нет.
 */
export function readActiveIndex() {
  try {
    const data = JSON.parse(readFileSync(join(dshHome(), STATE_FILE), 'utf8'))
    const index = Number(data?.active)
    return Number.isInteger(index) && index >= 0 ? index : 0
  } catch {
    return 0
  }
}

/**
 * Запомнить активный аккаунт.
 * @param index - номер в списке токенов.
 */
export function writeActiveIndex(index) {
  try {
    writeFileSync(join(dshHome(), STATE_FILE), `${JSON.stringify({ active: index }, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.warn(`dsh-mobile-ui: could not save the ngrok account index: ${String(error)}`)
  }
}

/**
 * Переключиться на выбранный аккаунт вручную.
 *
 * Запоминаем выбор, подставляем его токен в окружение и просим туннель
 * перезапуститься. Перезапуск не ждём: агент поднимается несколько секунд, а
 * браузер тем временем опрашивает состояние и подхватит новый адрес сам.
 *
 * @param config - разрешённая конфигурация строки.
 * @param index - номер аккаунта в пуле (с нуля).
 * @returns признак успеха.
 */
export function switchAccount(config, index) {
  const tokens = parseTokens(readConfiguredTokens(config))
  const target = Number(index)
  if (!Number.isInteger(target) || target < 0 || target >= tokens.length) {
    return { ok: false, error: 'bad-index' }
  }
  writeActiveIndex(target)
  process.env.NGROK_AUTHTOKEN = tokens[target]
  void restartTunnel().catch((error) => {
    console.warn(`dsh-mobile-ui: could not restart the tunnel after switching accounts: ${String(error)}`)
  })
  return { ok: true, index: target }
}

/**
 * Прочитать значение volatile-настройки.
 *
 * В рантайме harness отдаёт такие поля живым handle с методом `get()`, а не
 * строкой: без этой развилки подписи аккаунтов и токены читались как пустые, и
 * в списке ссылок все аккаунты назывались «Аккаунт 1», «Аккаунт 2»…
 *
 * @param config - разрешённая конфигурация строки.
 * @param name - имя поля в схеме.
 * @returns строковое значение или пустая строка.
 */
export function readStringField(config, name) {
  const field = config?.[name]
  if (field === undefined || field === null) return ''
  if (typeof field.get === 'function') return String(field.get() ?? '')
  return String(field)
}

/**
 * Прочитать значение поля с токенами.
 * @param config - разрешённая конфигурация строки.
 * @returns сырое значение поля.
 */
export function readConfiguredTokens(config) {
  return readStringField(config, 'ngrokAuthtoken')
}

/**
 * Прочитать значения поля с подписями аккаунтов.
 * @param config - разрешённая конфигурация строки.
 * @returns подписи через запятую.
 */
export function readConfiguredNames(config) {
  return readStringField(config, 'ngrokAuthtokenNames')
}

/**
 * Адрес, по которому плагин проверяет, жив ли туннель.
 * @param config - разрешённая конфигурация строки.
 * @returns URL или пустая строка.
 */
function publicUrlOf(config) {
  const file = typeof config?.tunnelUrlFile === 'string' && config.tunnelUrlFile !== ''
    ? config.tunnelUrlFile
    : join(dshHome(), 'tunnel-url.txt')
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * Запросить публичный адрес и вернуть начало тела ответа.
 * @param url - публичный адрес туннеля.
 * @returns тело (усечённое) или пустая строка при любой ошибке.
 */
function probeBody(url) {
  return new Promise((resolve) => {
    let call
    try {
      call = request(url, {
        method: 'GET',
        timeout: PROBE_TIMEOUT_MS,
        headers: { accept: 'text/html', 'ngrok-skip-browser-warning': '1' },
      }, (response) => {
        const chunks = []
        let size = 0
        response.on('data', (chunk) => {
          if (size >= PROBE_MAX_BYTES) return
          chunks.push(chunk)
          size += chunk.length
        })
        response.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')) })
        response.on('error', () => { resolve('') })
      })
    } catch {
      resolve('')
      return
    }
    call.on('timeout', () => { call.destroy(new Error('timeout')) })
    call.on('error', () => { resolve('') })
    call.end()
  })
}

/**
 * Ответ ngrok сообщает, что у аккаунта кончился трафик.
 * @param body - начало тела ответа публичного адреса.
 * @returns true, если это страница лимита.
 */
export function isLimitPage(body) {
  if (typeof body !== 'string' || body === '') return false
  return LIMIT_MARKERS.some((marker) => body.includes(marker))
}

/**
 * Следить за лимитом и переключать аккаунт.
 *
 * Проверка идёт раз в минуту по публичному адресу. Как только ngrok отдал
 * страницу лимита, активный аккаунт сдвигается на следующий, его токен
 * попадает в окружение, а агент перезапускается — со своим аккаунтом и своим
 * адресом. Переключение повторяется, пока находятся свежие аккаунты; когда
 * список исчерпан по кругу, плагин предупреждает в лог и ждёт.
 *
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installAccountRotation(ctx, config) {
  ctx.effect(() => {
    /** Выгружен ли плагин. */
    let disposed = false
    /** До какого времени проверки не имеют смысла. */
    let nextCheckAt = 0
    /** Сколько подряд неудачных переключений: все аккаунты упёрлись в лимит. */
    let exhausted = 0

    const check = async () => {
      if (disposed || Date.now() < nextCheckAt) return
      if (String(config?.tunnelProvider ?? 'ngrok') !== 'ngrok') return
      const tokens = parseTokens(readConfiguredTokens(config))
      // Один аккаунт — переключать некуда, лишние запросы ни к чему.
      if (tokens.length < 2) return
      const url = publicUrlOf(config)
      if (url === '') return

      const body = await probeBody(url)
      if (disposed || !isLimitPage(body)) return

      if (exhausted >= tokens.length) {
        console.warn('dsh-mobile-ui: все ngrok-аккаунты упёрлись в лимит трафика; ждём обновления квоты')
        nextCheckAt = Date.now() + 30 * 60 * 1000
        return
      }

      const index = (readActiveIndex() + 1) % tokens.length
      writeActiveIndex(index)
      process.env.NGROK_AUTHTOKEN = tokens[index]
      nextCheckAt = Date.now() + AFTER_SWITCH_MS
      exhausted += 1
      console.warn(`dsh-mobile-ui: ngrok limit reached; switching to account ${String(index + 1)}/${String(tokens.length)}`)

      const restarted = await restartTunnel()
      if (!restarted) console.warn('dsh-mobile-ui: could not restart the tunnel after switching accounts')
    }

    const timer = setInterval(() => { void check() }, PROBE_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()

    // Первая проверка не сразу: после старта туннель ещё поднимается.
    nextCheckAt = Date.now() + AFTER_SWITCH_MS

    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, 'dsh-mobile-ui: ngrok accounts')
}
