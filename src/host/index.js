// index.js — host-половина плагина: name, Config и apply.
//
// Работа слоя происходит в браузере; host-половине остаётся рассказать про
// публичную ссылку, подключение телефона и смену пароля (маршруты в
// `./status-route.js`, `./pair-route.js`, `./password-route.js`). Туннель —
// именованный cloudflared, им управляет вшитый пакет из `vendor/`; прежний
// провайдер больше не используется — ни токенов, ни счётчика трафика.
//
// Иконок приложения здесь нет намеренно: они лежат в браузерной половине как
// data URL (`src/client/03-icons/`).
import Schema from '@deepseek-ai/schemastery'
import { installPairRoutes } from './pair-route.js'
import { installPasswordRoute } from './password-route.js'
import { installStatusRoute } from './status-route.js'
import { installTelegramRoute } from './telegram-route.js'

/** Имя плагина в композиции профиля. */
export const name = 'mobile-ui'

/** Нужен веб-сервер: на нём живут маршруты для браузерной половины. */
export const inject = ['webServer']

/**
 * Настройки строки `mobile-ui`.
 *
 * `.volatile()` оставлен: harness отдаёт браузеру только записи с volatile-полями.
 */
export const Config = Schema.object({
  /** Файл, куда вшитый туннель пишет выданную ссылку. */
  tunnelUrlFile: Schema.string().default(''),
  /** Файл состояния вшитого relay: по нему видно, задан ли пароль. */
  relayStateFile: Schema.string().default(''),
  /** Порт relay: по нему host-половина ходит к нему и собирает адрес пароля. */
  relayPort: Schema.number().default(3443),
  /** Имя провайдера туннеля: показывается в настройках как есть. */
  tunnelProvider: Schema.string().default('cloudflared'),
  /** config.json Telegram-бота: сюда пишется токен из настроек. */
  telegramConfigFile: Schema.string().default(''),
})

/**
 * Включить host-половину.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function apply(ctx, config) {
  installStatusRoute(ctx, config)
  installPairRoutes(ctx, config)
  installPasswordRoute(ctx, config)
  installTelegramRoute(ctx, config)
}
