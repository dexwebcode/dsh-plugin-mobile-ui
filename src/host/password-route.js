// password-route.js — маршрут смены пароля на вход.
//
// Пароль хранит вшитый relay: он же его и проверяет. Плагин только принимает
// запрос из браузера и повторяет его от лица петлевого клиента, которого relay
// считает оператором. См. `./relay-client.js`.
import { readJsonBody, sendJson } from './http.js'
import { changePassword } from './relay-client.js'

/** Путь смены пароля. */
const PASSWORD_PATH = '/mobile-ui/password'

/**
 * Зарегистрировать маршрут смены пароля.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installPasswordRoute(ctx, config) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PASSWORD_PATH,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, message: 'Смена пароля принимается только POST-запросом.' })
        return
      }
      const body = await readJsonBody(req)
      if (body === undefined) {
        sendJson(res, 400, { ok: false, message: 'Пустой или повреждённый запрос.' })
        return
      }
      sendJson(res, 200, await changePassword(config.relayPort, body.password, body.confirm))
    },
  }), 'dsh-mobile-ui: password route')
}
