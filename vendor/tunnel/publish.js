// publish.js — что плагин делает с полученным адресом: файл, патч relay, проверка.
// Источник dsh-tunnel: `writeUrlFile`, `ensurePublicHostname`, `probe`.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { get as httpsGet } from 'node:https'

/**
 * Записать текущий публичный адрес туда, где его легко посмотреть руками.
 * @param path - путь к файлу.
 * @param url - публичный адрес.
 */
export function writeUrlFile(path, url) {
  try {
    writeFileSync(path, `${url}\n`, 'utf8')
  } catch {
    // недоступный файл — не повод не поднимать туннель
  }
}

/**
 * Прописать имя туннеля в `publicHostnames` строки relay.
 *
 * Строка relay в патче профиля заменяет `config` целиком, поэтому плагин
 * трогает ровно одну строку внутри неё и пишет файл через временный файл с
 * переименованием, чтобы HMR не увидел половину документа.
 * @param patchPath - путь к `cordis.patch.yml` профиля.
 * @param host - имя, которое должен принимать relay.
 * @returns `updated`, `unchanged`, `missing-row` или `missing-file`.
 */
export function ensurePublicHostname(patchPath, host) {
  if (!existsSync(patchPath)) return 'missing-file'
  const text = readFileSync(patchPath, 'utf8')
  const pattern = /^([ \t]*)publicHostnames:[ \t]*.*$/m
  const match = pattern.exec(text)
  if (match === null) return 'missing-row'

  const wanted = `publicHostnames: ['${host}']`
  if (match[0].trim() === wanted) return 'unchanged'

  const updated = text.replace(pattern, `${match[1]}${wanted}`)
  const temporary = `${patchPath}.tunnel-tmp`
  writeFileSync(temporary, updated, 'utf8')
  renameSync(temporary, patchPath)
  return 'updated'
}

/**
 * Проверка, что relay отвечает по публичному адресу.
 * @param url - публичный адрес.
 * @param timeoutMs - сколько ждать ответа.
 * @returns код ответа либо `undefined`.
 */
export function probe(url, timeoutMs) {
  return new Promise((resolve) => {
    const request = httpsGet(`${url}/relay/health`, { timeout: timeoutMs }, (response) => {
      response.resume()
      resolve(response.statusCode)
    })
    request.on('timeout', () => { request.destroy() })
    request.on('error', () => { resolve(undefined) })
  })
}
