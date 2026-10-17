// index.js — точка входа плагина: name, inject и apply.
// ВЕНДОР dsh-tunnel 1.2.0, только чтение: копия пакета, чтобы не требовать
// установки dsh-tunnel. ОТЛИЧИЕ ОТ ИСТОЧНИКА (одно): оба провайдера подставляют
// loopback-имя цели в Host — см. `./providers.js`. Это заменяет автозапись
// `publicHostnames` в патч профиля, недоступную в бандле.
/**
 * dsh-tunnel — публичный туннель, который живёт вместе с `dsh web`.
 *
 * Зачем. Публичный адрес даёт `dsh-relay`, но сам туннель до него — отдельный
 * процесс, который обычно поднимают руками и забывают погасить. Плюс быстрое
 * имя туннеля выдаётся заново при каждом запуске cloudflared, а relay пускает
 * только те имена, которые перечислены в его `publicHostnames`. Плагин
 * закрывает оба зазора.
 *
 * Почему провайдер по умолчанию cloudflared. ngrok блокирует российские
 * адреса (ERR_NGROK_9040), а Cloudflare отдаёт публичный адрес без аккаунта.
 * ngrok остаётся поддержанным — он может понадобиться через VPN.
 *
 * Три решения, которые делают ссылку устойчивой:
 *
 *   1. Агент запускается независимым процессом (`detached`). Иначе Ctrl+C в
 *      терминале `dsh web` приходит всей группе консоли и гасит туннель вместе
 *      с harness — а следующее имя окажется другим, и закладка перестанет
 *      работать (Cloudflare Error 1033).
 *   2. Живой агент переиспользуется, а не дублируется, поэтому перезапуск
 *      harness не меняет публичное имя.
 *   3. Сторож раз в `checkIntervalMs` проверяет управляющий порт и поднимает
 *      агента заново, если тот умер. Две подряд неудачи — потому что один
 *      таймаут на занятом порту ещё не означает смерть.
 *
 * По шагам:
 *   1. опрашивается управляющий порт провайдера (метрики cloudflared или API
 *      ngrok) — если туннель уже поднят, он переиспользуется;
 *   2. если туннеля нет, запускается бинарник провайдера;
 *   3. ожидается публичный адрес;
 *   4. адрес пишется в `$DSH_HOME/tunnel-url.txt` и прописывается в
 *      `publicHostnames` строки relay в патче профиля — relay перечитывает
 *      конфиг сам;
 *   5. фоном проверяется, что relay отвечает по публичному адресу.
 *
 * Плагин fail-soft: нет бинарника, занят порт, нет сети — предупреждение в лог,
 * harness продолжает работать без публичного доступа.
 * @module dsh-tunnel
 */
import { join } from 'node:path'
import { DEFAULTS } from './config.js'
import { PROVIDERS } from './providers.js'
import { dshHome, loggerFor } from './runtime.js'
import { supervise } from './supervisor.js'

/** Имя плагина в композиции профиля. */
export const name = 'tunnel'

/** Плагину не нужен ни один сервис harness — он только запускает процесс. */
export const inject = []

/**
 * Поднять туннель, следить за ним и регистрировать его имя в relay.
 * @param ctx - контекст плагина.
 * @param input - конфигурация строки профиля.
 */
export function apply(ctx, input) {
  const log = loggerFor(ctx)
  const configured = { ...DEFAULTS, ...(input ?? {}) }
  const provider = PROVIDERS[configured.provider]

  if (provider === undefined) {
    log.warn(`unknown provider ${JSON.stringify(configured.provider)}; expected one of ${Object.keys(PROVIDERS).join(', ')}`)
    return
  }

  const options = {
    ...configured,
    controlPort: configured.controlPort === 0 ? provider.defaultControlPort : configured.controlPort,
    profilePatch: configured.profilePatch === ''
      ? join(dshHome(), 'profiles', 'web', 'cordis.patch.yml')
      : configured.profilePatch,
    urlFile: configured.urlFile === '' ? join(dshHome(), 'tunnel-url.txt') : configured.urlFile,
  }

  try {
    supervise(ctx, provider, options, log)
  } catch (error) {
    log.warn(`could not register the tunnel: ${String(error)}`)
  }
}
