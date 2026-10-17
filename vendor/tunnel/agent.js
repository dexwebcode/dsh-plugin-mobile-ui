// agent.js — управляющий порт провайдера: жив ли агент и какой у него адрес.
// Источник dsh-tunnel: `getJson`, `existingUrl`, `waitForUrl`.
import { get as httpGet } from 'node:http'
import { delay } from './runtime.js'

/**
 * GET JSON с локального управляющего порта.
 * @param url - адрес запроса.
 * @returns разобранное тело либо `undefined`, когда порт не отвечает.
 */
export function getJson(url) {
  return new Promise((resolve) => {
    const request = httpGet(url, { timeout: 3000 }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => {
        try { resolve(JSON.parse(body)) } catch { resolve(undefined) }
      })
    })
    request.on('timeout', () => { request.destroy() })
    request.on('error', () => { resolve(undefined) })
  })
}

/**
 * Состояние агента по его управляющему порту.
 * @param provider - описание провайдера.
 * @param options - разрешённая конфигурация.
 * @returns публичный адрес, `null` когда агент жив без туннеля, либо
 *   `undefined`, когда агента нет вовсе.
 */
export async function existingUrl(provider, options) {
  const body = await getJson(`http://127.0.0.1:${options.controlPort}${provider.controlPath}`)
  if (body === undefined) return undefined
  return provider.publicUrl(body) ?? null
}

/**
 * Дождаться публичного адреса от управляющего порта.
 * @param provider - описание провайдера.
 * @param options - разрешённая конфигурация.
 * @param isStopped - проверка, что плагин не выгружен.
 * @returns адрес либо `undefined` по таймауту.
 */
export async function waitForUrl(provider, options, isStopped) {
  const deadline = Date.now() + options.startupTimeoutMs
  while (Date.now() < deadline && !isStopped()) {
    await delay(options.pollIntervalMs)
    const url = await existingUrl(provider, options)
    if (typeof url === 'string') return url
  }
  return undefined
}
