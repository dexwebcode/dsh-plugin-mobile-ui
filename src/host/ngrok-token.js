// ngrok-token.js — передача ngrok-токена в окружение процесса.
//
// Токен нужен ngrok, а запускает его вшитый туннель. Учить туннель про настройку
// не нужно: ngrok сам читает authtoken из переменной окружения NGROK_AUTHTOKEN, а
// туннель запускает ngrok дочерним процессом и наследует окружение.
//
// Значение берётся из volatile-настройки на каждом шаге, а не один раз при
// запуске: правка в настройках должна доехать без перезапуска harness. Туннель
// поднимет ngrok заново сам — его сторож перезапускает агента, если тот не
// поднялся, а без токена ngrok сразу завершается.

/** Имя переменной окружения, которую читает ngrok. */
const ENV_NAME = 'NGROK_AUTHTOKEN'

/** Как часто сверять окружение с настройкой. */
const SYNC_INTERVAL_MS = 2000

/**
 * Прочитать текущее значение настройки.
 * @param config - разрешённая конфигурация строки (volatile-поле — handle).
 * @returns токен или пустая строка.
 */
function readToken(config) {
  const field = config?.ngrokAuthtoken
  if (field === undefined || field === null) return ''
  if (typeof field.get === 'function') return String(field.get() ?? '')
  return String(field)
}

/**
 * Держать `NGROK_AUTHTOKEN` в согласии с настройкой.
 * @param ctx - контекст host-плагина.
 * @param config - разрешённая конфигурация строки.
 */
export function installNgrokToken(ctx, config) {
  ctx.effect(() => {
    /** Последнее значение, перенесённое в окружение: по нему видно смену. */
    let published = null

    /** Перенести текущее значение настройки в окружение. */
    const sync = () => {
      const token = readToken(config).trim()
      if (token === published) return
      published = token
      if (token === '') {
        delete process.env[ENV_NAME]
        console.log('dsh-mobile-ui: ngrok authtoken cleared; the tunnel will stop at the next restart')
      } else {
        process.env[ENV_NAME] = token
        console.log('dsh-mobile-ui: ngrok authtoken saved; the tunnel picks it up on its next start')
      }
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
