/**
 * build.mjs — сборка `lib/` из `src/` и `vendor/relay.js` из `vendor/relay/`.
 *
 * Три части собираются по-разному, и это не случайность:
 *
 *   * **host** (`src/host/*.js`) — обычные ES-модули: harness грузит их через
 *     Node, а Node умеет резолвить относительные импорты сам. Поэтому сборка
 *     просто копирует файлы в `lib/host/`;
 *   * **client** (`src/client/*.js`) — один файл для браузера: harness отдаёт
 *     клиентскую половину плагина ОДНИМ скриптом по URL, и загрузчик модулей
 *     не умеет тянуть соседние файлы. Поэтому фрагменты — это куски одного
 *     общего скоупа, и сборка склеивает их в порядке имён внутрь обёртки
 *     `window.__ModuleLoader__.load`;
 *   * **vendor/relay** (`vendor/relay/*.js`) — тот же приём для вшитого relay:
 *     это собранный бандл стороннего пакета с одним общим скоупом, где порядок
 *     объявлений значим. Фрагменты повторяют исходные модули `dsh-relay` и тоже
 *     пишутся без `import`/`export`; сборка возвращает их в единственный файл
 *     `vendor/relay.js`, который и грузит harness.
 *
 * Фрагменты намеренно пишутся без `import`/`export`: их общий скоуп — это и есть
 * тело модуля. Порядок задают числовые префиксы имён.
 *
 * Запуск: node scripts/build.mjs   (или: npm run build)
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')
const LIB = join(ROOT, 'lib')

/** Обёртка загрузчика модулей harness: ровно то, что ждёт браузерная половина. */
const LOADER_ID = 'dsh-mobile-ui'

/**
 * Собрать пути всех `.js` в каталоге, включая подпапки.
 * @param dir - каталог для обхода.
 * @param prefix - накопленный относительный путь (для рекурсии).
 * @returns относительные пути, отсортированные лексикографически.
 */
function walk(dir, prefix = '') {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) found.push(...walk(join(dir, entry.name), relative))
    else if (entry.name.endsWith('.js')) found.push(relative)
  }
  return found.sort()
}

/**
 * Склеить фрагменты клиентской половины в один файл.
 *
 * Порядок задают числовые префиксы имён и папок: сортировка по относительному
 * пути даёт ровно тот порядок объявлений, что нужен общему скоупу.
 *
 * @returns текст собранного `lib/client.js`.
 */
function buildClient() {
  const dir = join(SRC, 'client')
  const files = walk(dir)
  const header = files.find((name) => name.startsWith('00-'))
  const fragments = files.filter((name) => !name.startsWith('00-'))
  if (header === undefined) throw new Error('src/client: нет файла 00-header.js')
  if (fragments.length === 0) throw new Error('src/client: нет фрагментов')

  const read = (name) => readFileSync(join(dir, name), 'utf8').replace(/\s+$/, '')

  return [
    read(header),
    `window.__ModuleLoader__.load({ id: "${LOADER_ID}", factory: (require) => {`,
    'var module = { exports: {} }; var exports = module.exports;',
    '',
    ...fragments.map(read),
    '',
    'return module.exports; } });',
    '',
  ].join('\n')
}

/**
 * Скопировать host-половину: обычные ES-модули, переводятся как есть.
 * @returns список скопированных файлов.
 */
function buildHost() {
  const from = join(SRC, 'host')
  const to = join(LIB, 'host')
  mkdirSync(to, { recursive: true })
  const copied = []
  for (const name of readdirSync(from).filter((entry) => entry.endsWith('.js'))) {
    copyFileSync(join(from, name), join(to, name))
    copied.push(name)
  }
  if (!copied.includes('index.js')) throw new Error('src/host: нет index.js')
  return copied
}

/**
 * Склеить фрагменты вшитого relay обратно в один модуль.
 *
 * Границы `//#region` внутри фрагментов взяты из исходной сборки: они отделяют
 * один модуль `dsh-relay` от другого и служат картой исходника.
 *
 * @returns число склеенных фрагментов и строк в результате.
 */
function buildRelay() {
  const dir = join(ROOT, 'vendor', 'relay')
  const files = walk(dir)
  if (files.length === 0) throw new Error('vendor/relay: нет фрагментов')
  if (files[0] !== '00-header.js') throw new Error('vendor/relay: первым должен идти 00-header.js')
  const text = files.map((name) => readFileSync(join(dir, name), 'utf8')).join('')
  writeFileSync(join(ROOT, 'vendor', 'relay.js'), text, 'utf8')
  return { fragments: files.length, lines: text.split('\n').length }
}

rmSync(LIB, { recursive: true, force: true })
mkdirSync(LIB, { recursive: true })

const client = buildClient()
writeFileSync(join(LIB, 'client.js'), client, 'utf8')
const host = buildHost()
const relay = buildRelay()

console.log(`client.js: ${client.split('\n').length} строк`)
console.log(`host: ${host.join(', ')}`)
console.log(`vendor/relay.js: ${relay.lines} строк из ${relay.fragments} фрагментов`)
