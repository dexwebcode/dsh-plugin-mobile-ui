// index.js — host-половина плагина: name, Config и apply.
//
// Работа слоя происходит в браузере; host-половине остаётся отдать браузеру
// настройку с ngrok-токеном (`./ngrok-token.js`) и рассказать про публичную
// ссылку, подключение телефона и смену пароля (маршруты в `./status-route.js`,
// `./pair-route.js`, `./password-route.js`). Туннель и вход по паролю приходят
// вшитыми плагинами из `vendor/` — их подключает `cordis.patch.yml`.
//
// Иконок приложения здесь нет намеренно: они лежат в браузерной половине как
// data URL (`src/client/03-icons/`). Копирование PNG-файлов в каталог статики
// было промежуточным решением и оказалось ненужным — ни один запрос страницы к
// этим файлам не идёт.
import Schema from '@deepseek-ai/schemastery'
import { installNgrokToken } from './ngrok-token.js'
import { installPairRoutes } from './pair-route.js'
import { installPasswordRoute } from './password-route.js'
import { installStatusRoute } from './status-route.js'

/** Имя плагина в композиции профиля. */
export const name = 'mobile-ui'

/** Нужен веб-сервер: на нём живут маршруты для браузерной половины. */
export const inject = ['webServer']

/**
 * Настройки строки `mobile-ui`.
 *
 * `.volatile()` здесь не украшение: harness отдаёт браузеру только те записи, у
 * которых есть volatile-поля, и держит значение живым handle. Поэтому токен
 * правится прямо в диалоге настроек, а не правкой файлов профиля.
 */
export const Config = Schema.object({
  /** authtoken ngrok: без него ngrok не поднимает публичный туннель. */
  ngrokAuthtoken: Schema.string().default('').volatile(),
  /** Файл, куда вшитый туннель пишет выданную ссылку. */
  tunnelUrlFile: Schema.string().default(''),
  /** Файл состояния вшитого relay: по нему видно, задан ли пароль. */
  relayStateFile: Schema.string().default(''),
  /** Порт relay: по нему host-половина ходит к нему и собирает адрес пароля. */
  relayPort: Schema.number().default(3443),
  /** Имя провайдера туннеля: показывается в настройках как есть. */
  tunnelProvider: Schema.string().default('ngrok'),
})

/**
 * Включить host-половину.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function apply(ctx, config) {
  installNgrokToken(ctx, config)
  installStatusRoute(ctx, config)
  installPairRoutes(ctx, config)
  installPasswordRoute(ctx, config)
}
