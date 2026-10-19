// pair-route.js — маршруты подключения телефона.
//
// Приглашение (QR и одноразовый код) живёт в памяти вшитого relay и больше нигде
// не доступно, поэтому host-половина спрашивает relay по петлевому адресу и
// отдаёт ответ браузеру как есть. См. `./relay-client.js`.
import { sendJson } from './http.js'
import { fetchInvitation, requestNewCode } from './relay-client.js'

/** Путь приглашения: QR и код. */
const PAIR_PATH = '/mobile-ui/pair'

/** Путь выпуска нового кода. */
const NEW_CODE_PATH = '/mobile-ui/pair/new'

/**
 * Отдать браузеру текущее приглашение.
 * @param port - порт relay.
 * @param res - ответ маршрута.
 */
async function replyInvitation(port, res) {
  const invitation = await fetchInvitation(port)
  if (invitation === undefined) {
    sendJson(res, 503, { error: 'relay-unavailable' })
    return
  }
  sendJson(res, 200, invitation)
}

/**
 * Зарегистрировать маршруты подключения телефона.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installPairRoutes(ctx, config) {
  ctx.effect(() => {
    const offInvitation = ctx.webServer.register({
      kind: 'exact',
      path: PAIR_PATH,
      handler: (req, res) => replyInvitation(config.relayPort, res),
    })
    const offNewCode = ctx.webServer.register({
      kind: 'exact',
      path: NEW_CODE_PATH,
      handler: async (req, res) => {
        await requestNewCode(config.relayPort)
        await replyInvitation(config.relayPort, res)
      },
    })
    return () => {
      offNewCode()
      offInvitation()
    }
  }, 'dsh-plugin-mobile-ui: pairing routes')
}
