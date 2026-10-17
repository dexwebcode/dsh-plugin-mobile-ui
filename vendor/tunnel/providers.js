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
 * ПРАВКА ВЕНДОРА (dsh-mobile-ui): обе ветки подставляют в Host заголовок
 * loopback-имя цели (`--http-host-header` у cloudflared, `--host-header` у
 * ngrok). Зачем: relay отвечает только тем authority, что перечислены в его
 * `bind`/`publicHostnames`/`trustedHosts`, а loopback-имена он принимает всегда.
 * Без подстановки публичный адрес получает 403 «untrusted-host», потому что имя
 * туннеля в конфиг relay не попадает. Подстановка делает это ненужным.
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
  ngrok: {
    binaryName: 'ngrok',
    defaultControlPort: 4040,
    controlPath: '/api/tunnels',
    args: (options) => {
      const args = ['http', options.target, '--log=stdout']
      const host = originHost(options.target)
      if (host !== undefined) args.push(`--host-header=${host}`)
      return args
    },
    publicUrl: (body) => {
      const tunnels = Array.isArray(body?.tunnels) ? body.tunnels : []
      const found = tunnels.find(
        (tunnel) => typeof tunnel?.public_url === 'string' && tunnel.public_url.startsWith('https://'),
      )
      return found?.public_url
    },
  },
}
