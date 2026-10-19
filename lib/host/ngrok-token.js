// ngrok-token.js — передача активного ngrok-токена в окружение процесса.
//
// Токен нужен ngrok, а запускает его вшитый туннель. Учить туннель про настройку
// не нужно: ngrok читает authtoken из переменной окружения NGROK_AUTHTOKEN, а
// туннель запускает ngrok дочерним процессом и наследует окружение. Провайдер
// дополнительно передаёт токен флагом `--authtoken` (см. `vendor/tunnel/providers.js`):
// без флага этот ngrok берёт токен из глобального конфига и игнорирует окружение.
//
// В поле настройки может лежать несколько токенов — это пул аккаунтов на случай
// лимита трафика (`./ngrok-accounts.js`). Здесь в окружение попадает только
// активный: индекс помнит состояние, а смена аккаунта пишет его туда же.
//
// Значение берётся из volatile-настройки на каждом шаге, а не один раз при
// запуске: правка в настройках должна доехать без перезапуска harness.

import { parseTokens, readActiveIndex, readConfiguredTokens } from './ngrok-accounts.js'

/** Имя переменной окружения, которую читает ngrok. */
const ENV_NAME = 'NGROK_AUTHTOKEN'

/** Как часто сверять окружение с настройкой. */
const SYNC_INTERVAL_MS = 2000

/**
 * Держать `NGROK_AUTHTOKEN` в согласии с настройкой и активным аккаунтом.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installNgrokToken(ctx, config) {
  ctx.effect(() => {
    /** Последнее значение, перенесённое в окружение: по нему видно смену. */
    let published = null

    /** Перенести активный токен в окружение. */
    const sync = () => {
      const tokens = parseTokens(readConfiguredTokens(config))
      if (tokens.length === 0) {
        if (published !== '') {
          published = ''
          delete process.env[ENV_NAME]
          console.log('dsh-mobile-ui: ngrok authtoken cleared; the tunnel will stop at the next restart')
        }
        return
      }

      // Индекс мог остаться от прежнего, более длинного списка.
      const index = Math.min(readActiveIndex(), tokens.length - 1)
      const token = tokens[index]
      if (token === published) return
      published = token
      process.env[ENV_NAME] = token
      const note = tokens.length > 1 ? ` (account ${String(index + 1)}/${String(tokens.length)})` : ''
      console.log(`dsh-mobile-ui: ngrok authtoken saved${note}; the tunnel picks it up on its next start`)
    }

    sync()
    const timer = setInterval(sync, SYNC_INTERVAL_MS)
    if (typeof timer.unref === 'function') timer.unref()

    return () => {
      clearInterval(timer)
      delete process.env[ENV_NAME]
    }
  }, 'dsh-mobile-ui: ngrok token')
}
