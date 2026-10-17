// status-route.js — маршрут, по которому браузер узнаёт состояние доступа.
//
// Браузерная половина не умеет читать файлы хоста, а публичную ссылку выдаёт
// туннель. Мост между ними — обычный HTTP-маршрут на веб-сервере harness:
// страница запрашивает его на том же origin, что и интерфейс, поэтому ни токен,
// ни отдельный порт не нужны.
import { sendJson } from './http.js'
import { passwordPageUrl, readPasswordSet, readTunnelUrl } from './status.js'

/** Путь маршрута состояния. */
const STATUS_PATH = '/mobile-ui/status'

/**
 * Собрать состояние публичного доступа.
 * @param config - разрешённая конфигурация строки.
 * @returns ссылка туннеля, провайдер и признак пароля.
 */
export function collectStatus(config) {
  return {
    url: readTunnelUrl(config.tunnelUrlFile),
    provider: typeof config.tunnelProvider === 'string' ? config.tunnelProvider : 'ngrok',
    passwordSet: readPasswordSet(config.relayStateFile),
    passwordUrl: passwordPageUrl(config.relayPort),
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
  }), 'dsh-mobile-ui: tunnel status route')
}
