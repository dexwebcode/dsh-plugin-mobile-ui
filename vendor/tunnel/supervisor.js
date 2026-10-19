// supervisor.js — жизненный цикл туннеля: подъём, публикация адреса, сторож.
// Источник dsh-tunnel: тело эффекта из `apply`.
import { spawn } from 'node:child_process'
import { existingUrl, waitForUrl } from './agent.js'
import { ensurePublicHostname, probe, writeUrlFile } from './publish.js'
import { delay, resolveBinary } from './runtime.js'

/**
 * Перезапуск активного туннеля.
 *
 * Сторож перезапускает только умершего агента: живой агент с исчерпанным
 * аккаунтом ngrok для него здоров (порт отвечает, ссылка выдана). Смена аккаунта
 * по лимиту трафика (`lib/host/ngrok-accounts.js`) поэтому просит перезапуск
 * здесь — только эффект владеет `child`.
 */
let restartActive = null

/**
 * Перезапустить активный туннель, если он вообще поднимался.
 * @returns true, если перезапуск выполнен.
 */
export function restartTunnel() {
  if (restartActive === null) return Promise.resolve(false)
  return restartActive()
}

/**
 * Поднять туннель, следить за ним и регистрировать его имя в relay.
 *
 * Тело эффекта держит всё состояние агента в замыкании: `child` — запущенный
 * процесс провайдера, `disposed` — признак выгрузки плагина, `misses` — счётчик
 * подряд неудачных проверок управляющего порта.
 *
 * @param ctx - контекст плагина.
 * @param provider - описание выбранного провайдера.
 * @param options - разрешённая конфигурация с подставленными умолчаниями.
 * @param log - пара функций логирования.
 */
export function supervise(ctx, provider, options, log) {
  ctx.effect(() => {
    let child
    let disposed = false
    let misses = 0

    const killOwn = () => {
      if (child !== undefined && child.exitCode === null) {
        try { child.kill() } catch { /* процесс уже мог завершиться */ }
      }
    }
    if (!options.keepTunnelOnExit) process.once('exit', killOwn)

    /** Найти живой туннель или поднять новый. */
    const acquire = async () => {
      const running = await existingUrl(provider, options)
      if (typeof running === 'string') {
        log.info(`reusing the agent already listening on :${String(options.controlPort)}`)
        return running
      }
      if (running === null) {
        log.info(`agent on :${String(options.controlPort)} is up; waiting for its public URL`)
        return await waitForUrl(provider, options, () => disposed)
      }

      const binary = resolveBinary(options, provider)
      const args = provider.args(options)
      try {
        // detached — своя группа процессов: Ctrl+C в терминале `dsh web`
        // не должен убивать туннель вместе с harness.
        child = spawn(binary, args, { stdio: 'ignore', windowsHide: true, detached: true })
        child.unref()
      } catch (error) {
        log.warn(`could not start ${binary}: ${String(error)}`)
        return undefined
      }
      child.on('error', (error) => { log.warn(`${provider.binaryName} failed to start: ${String(error)}`) })
      child.on('exit', (code, signal) => {
        if (!disposed) log.warn(`${provider.binaryName} exited (${code === null ? String(signal) : String(code)})`)
      })
      log.info(`started ${binary} ${args.join(' ')}`)
      return await waitForUrl(provider, options, () => disposed)
    }

    /** Привести публичный адрес в порядок: файл, relay, проверка. */
    const publish = async (url) => {
      writeUrlFile(options.urlFile, url)
      log.info(`public URL: ${url}  (also written to ${options.urlFile})`)

      if (options.updateRelayHostnames) {
        const host = new URL(url).host
        const result = ensurePublicHostname(options.profilePatch, host)
        if (result === 'updated') log.info(`relay publicHostnames updated to ${host}; the relay reloads it itself`)
        else if (result === 'unchanged') log.info(`relay already trusts ${host}`)
        else if (result === 'missing-row') log.warn(`no relay row in ${options.profilePatch}; add publicHostnames: ['${host}'] by hand`)
        else log.warn(`patch file not found: ${options.profilePatch}`)
      }

      await delay(2500)
      const status = await probe(url, options.healthTimeoutMs)
      if (status === 200) log.info('relay answers on the public URL (200); sign in once per browser and bookmark it')
      else if (status !== undefined) log.warn(`relay answered ${String(status)} on the public URL; the name may not be in publicHostnames yet`)
      else log.warn('relay did not answer on the public URL yet; the tunnel may still be propagating')
    }

    /** Полный цикл: поднять (или переиспользовать) и опубликовать. */
    const ensure = async () => {
      const url = await acquire()
      if (disposed) return
      if (url === undefined) {
        log.warn(`no public URL within ${String(options.startupTimeoutMs)} ms — run the provider once by hand to see its own error (ngrok additionally blocks Russian addresses with ERR_NGROK_9040)`)
        return
      }
      await publish(url)
    }

    // Регистрируем перезапуск: им пользуется смена ngrok-аккаунта по лимиту.
    restartActive = async () => {
      if (disposed) return false
      killOwn()
      child = undefined
      await delay(1000)
      await ensure()
      return true
    }

    void ensure().catch((error) => { log.warn(`tunnel setup failed: ${String(error)}`) })

    // Сторож: живой туннель не должен умирать незамеченным.
    const watchdog = setInterval(() => {
      if (disposed) return
      void (async () => {
        const alive = await existingUrl(provider, options)
        if (alive !== undefined) { misses = 0; return }
        misses += 1
        if (misses < 2) return
        misses = 0
        log.warn('the tunnel is gone; starting a new one')
        await ensure()
      })().catch((error) => { log.warn(`watchdog failed: ${String(error)}`) })
    }, options.checkIntervalMs)
    if (typeof watchdog.unref === 'function') watchdog.unref()

    return () => {
      disposed = true
      restartActive = null
      clearInterval(watchdog)
      if (!options.keepTunnelOnExit) process.removeListener('exit', killOwn)
    }
  }, 'dsh-tunnel: public tunnel')
}
