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
      // --host-header намеренно не передаётся: с ним relay видит Host: 127.0.0.1,
      // а браузер присылает Origin: https://<публичное имя>, и checkFence()
      // отклоняет модульные скрипты как "origin-mismatch" — страница на телефоне
      // не грузится. Настоящий Host разрешён через publicHostnames.
      const args = ['http', options.target, '--log=stdout']
      // authtoken передаём флагом: env NGROK_AUTHTOKEN этот ngrok не применяет,
      // если токен уже есть в глобальном конфиге, и агент поднимается на старом
      // аккаунте (у него кончился трафик — ERR_NGROK_725).
      const token = process.env.NGROK_AUTHTOKEN ?? ''
      if (token !== '') args.push('--authtoken', token)
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
