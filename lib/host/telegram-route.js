// telegram-route.js — хранит токен Telegram-бота и перезапускает его.
//
// Настройки Mobile UI — единственное место, где токен вводится руками: плагин
// проверяет его у Telegram (getMe), пишет в `config.json` бота и ставит
// `.runtime/restart.flag`, чтобы бот переподключился к новому токену.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { readJsonBody, sendJson } from './http.js'

/** Путь настроек Telegram API. */
const TELEGRAM_PATH = '/mobile-ui/telegram'

/** Токен Telegram: <числа>:<строка>. */
const TOKEN_PATTERN = /^\d{5,}:[A-Za-z0-9_-]{20,}$/

/** Сколько ждать ответа api.telegram.org. */
const GET_ME_TIMEOUT_MS = 8000

/**
 * Замаскировать токен: видно только bot id, остальное — звёздочки.
 * @param token - сохранённый токен.
 * @returns безопасная для показа строка.
 */
function maskToken(token) {
  if (typeof token !== 'string' || token === '') return ''
  const colon = token.indexOf(':')
  if (colon <= 0) return '***'
  return `${token.slice(0, colon)}:${'*'.repeat(12)}`
}

/**
 * Прочитать config.json бота.
 * @param file - путь к файлу.
 * @returns разобранный объект или `undefined`.
 */
async function readBotConfig(file) {
  try {
    const text = await readFile(file, 'utf8')
    const data = JSON.parse(text)
    return data !== null && typeof data === 'object' ? data : undefined
  } catch {
    return undefined
  }
}

/**
 * Проверить токен у Telegram.
 * @param token - токен бота.
 * @returns имя бота или `undefined`, если Telegram токен не принял.
 */
async function getMe(token) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(GET_ME_TIMEOUT_MS),
    })
    if (!response.ok) return undefined
    const data = await response.json()
    if (data?.ok !== true || data?.result?.username === undefined) return undefined
    return String(data.result.username)
  } catch {
    return undefined
  }
}

/**
 * Записать config.json атомарно: временный файл рядом, затем rename.
 * @param file - путь к файлу.
 * @param data - новое содержимое.
 */
async function writeBotConfig(file, data) {
  const temporary = `${file}.tmp`
  await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  await rename(temporary, file)
}

/**
 * Поставить флаг перезапуска рядом с config.json.
 * @param configFile - путь к config.json бота.
 */
async function requestBotRestart(configFile) {
  const directory = join(dirname(configFile), '.runtime')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'restart.flag'), 'telegram-token\n', 'utf8')
}

/**
 * Зарегистрировать маршрут настроек Telegram API.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installTelegramRoute(ctx, config) {
  const configFile = (config.telegramConfigFile || '').trim()

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: TELEGRAM_PATH,
    handler: async (req, res) => {
      if (configFile === '') {
        sendJson(res, 200, {
          ok: true,
          configured: false,
          message: 'Путь к config.json бота не задан: укажите telegramConfigFile в настройках плагина.',
        })
        return
      }

      if (req.method === 'GET') {
        const data = await readBotConfig(configFile)
        sendJson(res, 200, {
          ok: true,
          configured: true,
          hasToken: typeof data?.botToken === 'string' && data.botToken !== '',
          maskedToken: maskToken(data?.botToken),
          botUsername: typeof data?.botUsername === 'string' ? data.botUsername : '',
        })
        return
      }

      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, message: 'Настройки Telegram принимаются только GET и POST.' })
        return
      }

      const body = await readJsonBody(req)
      if (body === undefined) {
        sendJson(res, 400, { ok: false, message: 'Пустой или повреждённый запрос.' })
        return
      }

      const token = typeof body.token === 'string' ? body.token.trim() : ''
      if (!TOKEN_PATTERN.test(token)) {
        sendJson(res, 400, {
          ok: false,
          message: 'Токен не похож на токен Telegram. Скопируйте его из @BotFather целиком: 123456789:AA…',
        })
        return
      }

      const username = await getMe(token)
      if (username === undefined) {
        sendJson(res, 400, {
          ok: false,
          message: 'Telegram не принял токен: проверьте, что он от @BotFather и бот ещё не удалён.',
        })
        return
      }

      const data = (await readBotConfig(configFile)) ?? {}
      data.botToken = token
      data.botUsername = username
      try {
        await writeBotConfig(configFile, data)
        await requestBotRestart(configFile)
      } catch (error) {
        sendJson(res, 500, {
          ok: false,
          message: `Не удалось сохранить токен: ${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }

      sendJson(res, 200, {
        ok: true,
        botUsername: username,
        restarting: true,
        message: `Токен сохранён. Бот @${username} перезапускается…`,
      })
    },
  }), 'dsh-plugin-mobile-ui: telegram route')
}
