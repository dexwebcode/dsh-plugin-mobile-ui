// status-route.js — маршрут, по которому браузер узнаёт состояние доступа.
//
// Браузерная половина не умеет читать файлы хоста, а публичную ссылку выдаёт
// туннель. Мост между ними — обычный HTTP-маршрут на веб-сервере harness:
// страница запрашивает его на том же origin, что и интерфейс, поэтому ни токен,
// ни отдельный порт не нужны.
import { sendJson, readJsonBody } from './http.js'
import { passwordPageUrl, readPasswordSet, readTunnelUrl } from './status.js'
import { accountLinks, parseTokens, readActiveIndex, readConfiguredTokens, rememberUrl, switchAccount } from './ngrok-accounts.js'

/** Путь маршрута состояния. */
const STATUS_PATH = '/mobile-ui/status'

/** Путь ручного переключения аккаунта. */
const ACCOUNT_PATH = '/mobile-ui/account'

/**
 * Собрать состояние публичного доступа.
 *
 * Заодно запоминает публичный адрес активного аккаунта: у каждого ngrok-аккаунта
 * свой постоянный домен, и показать его для неактивных можно только по памяти
 * прошлых запусков.
 *
 * @param config - разрешённая конфигурация строки.
 * @returns ссылка туннеля, провайдер, признак пароля и список аккаунтов.
 */
export function collectStatus(config) {
  const url = readTunnelUrl(config.tunnelUrlFile)
  const tokens = parseTokens(readConfiguredTokens(config))
  if (tokens.length > 0 && url !== '') {
    const active = Math.min(readActiveIndex(), tokens.length - 1)
    rememberUrl(tokens[active], url)
  }
  return {
    url,
    provider: typeof config.tunnelProvider === 'string' ? config.tunnelProvider : 'ngrok',
    passwordSet: readPasswordSet(config.relayStateFile),
    passwordUrl: passwordPageUrl(config.relayPort),
    links: accountLinks(config),
  }
}

/**
 * Зарегистрировать маршрут состояния.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installStatusRoute(ctx, config) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: STATUS_PATH,
    handler: (req, res) => { sendJson(res, 200, collectStatus(config)) },
  }), 'dsh-plugin-mobile-ui: tunnel status route')

  // Ручное переключение аккаунта: браузер присылает номер в пуле.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ACCOUNT_PATH,
    handler: async (req, res) => {
      if ((req.method ?? 'GET').toUpperCase() !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }
      const body = await readJsonBody(req)
      if (body === undefined || body.index === undefined) {
        sendJson(res, 400, { ok: false, error: 'bad-request' })
        return
      }
      const result = switchAccount(config, body.index)
      sendJson(res, result.ok ? 200 : 400, result)
    },
  }), 'dsh-plugin-mobile-ui: account switch route')
}
