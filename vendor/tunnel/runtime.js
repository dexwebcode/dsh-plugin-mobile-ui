// runtime.js — среда запуска: дом harness, поиск бинарника, лог, пауза.
// Источник dsh-tunnel: `delay`, `loggerFor`, `dshHome`, `resolveBinary`.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Пауза. @param ms - миллисекунды. @returns промис. */
export function delay(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms) })
}

/**
 * Логирование в логгер harness, с откатом на консоль.
 * @param ctx - контекст плагина.
 * @returns пара функций логирования.
 */
export function loggerFor(ctx) {
  const logger = ctx.get('logger')
  return {
    info: (message) => void (logger?.info?.(`[tunnel] ${message}`) ?? console.log(`[tunnel] ${message}`)),
    warn: (message) => void (logger?.warn?.(`[tunnel] ${message}`) ?? console.warn(`[tunnel] ${message}`)),
  }
}

/** Домашний каталог harness. @returns путь из `DSH_HOME` или `~/.dsh`. */
export function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Путь к бинарнику провайдера: явный из конфигурации, затем `$DSH_HOME/bin`,
 * затем PATH.
 * @param options - разрешённая конфигурация.
 * @param provider - описание провайдера.
 * @returns путь или имя для поиска системой.
 */
export function resolveBinary(options, provider) {
  if (options.binary !== '') return options.binary

  const extension = process.platform === 'win32' ? '.exe' : ''
  const bundled = join(dshHome(), 'bin', provider.binaryName + extension)
  if (existsSync(bundled)) return bundled

  const extensions = process.platform === 'win32'
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : ['']
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    for (const candidateExtension of extensions) {
      const candidate = join(directory, provider.binaryName + candidateExtension)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // недоступная запись PATH не должна ломать запуск
      }
    }
  }
  return provider.binaryName
}
