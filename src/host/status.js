// status.js — чтение состояния публичного доступа для браузерной половины.
//
// Всё, что нужно показать пользователю, уже лежит на диске: вшитый туннель пишет
// выданную ссылку в файл, а вшитый relay держит признак пароля в своём состоянии.
// Отсюда это читается и отдаётся браузеру через маршрут (см. `./status-route.js`).
import { readFileSync } from 'node:fs'

/**
 * Прочитать публичную ссылку туннеля.
 * @param file - путь к файлу, куда туннель пишет выданный адрес.
 * @returns ссылка или пустая строка, если туннель ещё не поднялся.
 */
export function readTunnelUrl(file) {
  if (typeof file !== 'string' || file === '') return ''
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    return ''
  }
}

/**
 * Узнать, задан ли пароль на вход.
 * @param file - путь к файлу состояния relay.
 * @returns true, если пароль уже установлен.
 */
export function readPasswordSet(file) {
  if (typeof file !== 'string' || file === '') return false
  try {
    const state = JSON.parse(readFileSync(file, 'utf8'))
    return state !== null && typeof state === 'object' && state.password !== undefined
  } catch {
    return false
  }
}

/**
 * Адрес страницы, на которой задаётся пароль.
 * @param port - порт, на котором слушает relay.
 * @returns адрес страницы установки пароля.
 */
export function passwordPageUrl(port) {
  const value = Number.isFinite(Number(port)) ? Number(port) : 3443
  return `https://127.0.0.1:${value}/relay/password`
}
