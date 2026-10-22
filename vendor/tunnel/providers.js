// providers.js — провайдеры туннеля и правка вендора в заголовке Host.
// Источник dsh-tunnel: `originHost`, `PROVIDERS`.

/**
 * Имя цели без порта — то, что туннель обязан подставить в Host.
 * @param target - адрес relay из конфигурации.
 * @returns host либо undefined, если адрес не разобрать.
 */
export function originHost(target) {
  try {
    return new URL(target).hostname
  } catch {
    return undefined
  }
}

/**
 * Провайдеры туннеля. У каждого — свой управляющий HTTP-порт, по которому
 * видно, что агент жив, и откуда берётся публичный адрес.
 *
 * ПРАВКА ВЕНДОРА (dsh-plugin-mobile-ui): quick-туннель cloudflared подставляет
 * в Host loopback-имя цели (`--http-host-header`). Зачем: relay отвечает только
 * тем authority, что перечислены в его `bind`/`publicHostnames`/`trustedHosts`,
 * а loopback-имена он принимает всегда. Именованный туннель этого не делает —
 * его имя уже в `publicHostnames` relay.
 */
export const PROVIDERS = {
  cloudflared: {
    binaryName: 'cloudflared',
    defaultControlPort: 20241,
    controlPath: '/quicktunnel',
    args: (options) => {
      const args = [
        'tunnel', '--url', options.target,
        '--metrics', `127.0.0.1:${options.controlPort}`,
        '--no-autoupdate',
      ]
      // Самоподписанный сертификат relay: проверку origin-сертификата снимаем,
      // публичный TLS всё равно терминирует Cloudflare.
      if (options.target.startsWith('https://')) args.push('--no-tls-verify')
      const host = originHost(options.target)
      if (host !== undefined) args.push('--http-host-header', host)
      return args
    },
    publicUrl: (body) => {
      const host = body?.hostname
      return typeof host === 'string' && host !== '' ? `https://${host}` : undefined
    },
  },
  /**
   * Именованный (не quick) туннель cloudflared с постоянным адресом.
   *
   * Отличие от `cloudflared`: тот поднимает временный `*.trycloudflare.com` и
   * отдаёт имя через `/quicktunnel`. Здесь имя закреплено заранее (CNAME в зоне
   * Cloudflare), поэтому адрес берётся из конфигурации, а `/ready` служит только
   * признаком того, что соединение с edge установлено.
   */
  'cloudflared-named': {
    binaryName: 'cloudflared',
    defaultControlPort: 20242,
    controlPath: '/ready',
    staticUrl: (options) => options.namedUrl,
    args: (options) => [
      // Глобальные флаги — до команды: `run` принимает только имя туннеля,
      // и `--metrics`, поставленный после него, читается как лишний аргумент.
      '--config', options.namedConfig,
      '--metrics', `127.0.0.1:${options.controlPort}`,
      '--no-autoupdate',
      'tunnel', 'run', options.namedTunnel,
    ],
  },
}
