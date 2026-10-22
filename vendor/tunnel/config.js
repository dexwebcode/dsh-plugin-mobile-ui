// config.js — значения по умолчанию для строки профиля.
// Источник dsh-tunnel: `DEFAULTS`.

/** Значения по умолчанию; строка профиля может переопределить любое. */
export const DEFAULTS = {
  provider: 'cloudflared',
  target: 'https://127.0.0.1:3443',
  binary: '',
  controlPort: 0,
  profilePatch: '',
  urlFile: '',
  updateRelayHostnames: true,
  keepTunnelOnExit: true,
  // Для провайдера `cloudflared-named`: имя туннеля, его config.yml и
  // постоянный публичный адрес (закреплён CNAME-записью в зоне Cloudflare).
  namedTunnel: '',
  namedConfig: '',
  namedUrl: '',
  startupTimeoutMs: 60000,
  pollIntervalMs: 700,
  checkIntervalMs: 30000,
  healthTimeoutMs: 15000,
}
