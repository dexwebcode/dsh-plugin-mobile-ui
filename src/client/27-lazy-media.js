// 27-lazy-media.js — картинки в переписке грузятся только по нажатию.
//
// Зачем: проекция сессии приходит по WebSocket целиком, но вложения — отдельными
// запросами `/api/file?…`, и каждый скриншот в переписке стоит 150–340 КБ. Замер
// на живой сессии: 1.2 МБ только на открытие чата, из них картинки — заметная
// часть. В экономном режиме показываем плашку «Загрузить · 148 КБ» и качаем файл
// лишь когда человек сам нажмёт.
//
// Почему подменяется `src` у того же `<img>`, а не вставляется кнопка рядом:
// разметку переписки держит React. Лишний узел-сосед он может снести при
// перерисовке, а собственные атрибуты элемента переживают её спокойно.

/** Атрибут с настоящим адресом: пока он есть, картинка не загружена. */
const LAZY_SRC_ATTR = 'data-dsh-lazy-src'

/** Атрибут с известным размером файла в байтах (для подписи на плашке). */
const LAZY_SIZE_ATTR = 'data-dsh-lazy-size'

/** Отметка «человек уже загрузил эту картинку»: второй раз не сворачиваем. */
const LAZY_DONE_ATTR = 'data-dsh-lazy-done'

/** Высота плашки: держим её, чтобы переписка не прыгала после загрузки. */
const LAZY_HEIGHT_PX = 120

/** Как часто искать новые картинки: раз в секунду дешевле наблюдателя за атрибутами. */
const LAZY_SCAN_MS = 1200

/** Адреса, которые считаем вложениями: их и откладываем. */
const LAZY_URL_PATTERN = /\/api\/file\?|\/attachments\//

/**
 * Плашка-заглушка как SVG в data URL: она рисуется прямо в `<img>`, поэтому
 * никаких лишних узлов в переписке не появляется.
 * @param label - подпись на плашке.
 * @returns data URL с картинкой.
 */
function lazyPlaceholder(label) {
  const safe = String(label).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  const svg = [
    "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='240' viewBox='0 0 640 240'>",
    "<rect width='640' height='240' rx='24' fill='#e9ecf2'/>",
    "<text x='320' y='118' fill='#5a6270' font-family='system-ui,-apple-system,Segoe UI,Roboto,sans-serif'",
    " font-size='26' text-anchor='middle'>",
    safe,
    '</text>',
    '</svg>',
  ].join('')
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/**
 * Подпись для плашки.
 * @param bytes - известный размер или 0.
 * @returns текст.
 */
function lazyLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Загрузить картинку'
  const kb = Math.round(bytes / 1024)
  const size = kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} МБ` : `${kb} КБ`
  return `Загрузить · ${size}`
}

/**
 * Узнать размер файла, не качая его.
 *
 * Запрос диапазона `bytes=0-0` стоит пару сотен байт, а в ответе есть
 * `Content-Range: bytes 0-0/152345` — из него и берём полный размер.
 *
 * @param url - адрес вложения.
 * @returns размер в байтах или 0, если не узнали.
 */
async function lazyFileSize(url) {
  try {
    const response = await fetch(url, { headers: { range: 'bytes=0-0' }, cache: 'no-store' })
    const range = response.headers.get('content-range')
    if (range !== null) {
      const total = Number(range.split('/')[1])
      if (Number.isFinite(total) && total > 0) return total
    }
    const length = Number(response.headers.get('content-length'))
    return Number.isFinite(length) ? length : 0
  } catch {
    return 0
  }
}

/** Картинка — вложение, которое стоит отложить. */
function isLazyCandidate(image) {
  if (image.hasAttribute(LAZY_SRC_ATTR)) return false
  // Уже загруженную человеком не трогаем: иначе следующее сканирование свернёт
  // её обратно, и клик будет выглядеть сломанным.
  if (image.hasAttribute(LAZY_DONE_ATTR)) return false
  const src = image.getAttribute('src') ?? ''
  if (src === '' || src.startsWith('data:') || src.startsWith('blob:')) return false
  return LAZY_URL_PATTERN.test(src)
}

/**
 * Свернуть картинку в плашку.
 * @param image - элемент картинки.
 */
function lazyFold(image) {
  const src = image.getAttribute('src') ?? ''
  image.setAttribute(LAZY_SRC_ATTR, src)
  image.style.height = `${LAZY_HEIGHT_PX}px`
  image.style.maxWidth = '100%'
  image.style.objectFit = 'cover'
  image.style.cursor = 'pointer'
  image.style.borderRadius = '12px'
  image.setAttribute('src', lazyPlaceholder(lazyLabel(0)))
  image.setAttribute('title', 'Нажмите, чтобы загрузить картинку')

  // Размер догружаем отдельно и подменяем подпись, если он пришёл.
  void lazyFileSize(src).then((bytes) => {
    if (!image.hasAttribute(LAZY_SRC_ATTR) || bytes <= 0) return
    image.setAttribute(LAZY_SIZE_ATTR, String(bytes))
    image.setAttribute('src', lazyPlaceholder(lazyLabel(bytes)))
  })
}

/**
 * Вернуть картинку на место — загрузить настоящий файл.
 * @param image - элемент картинки.
 */
function lazyUnfold(image) {
  const src = image.getAttribute(LAZY_SRC_ATTR)
  if (src === null) return
  image.removeAttribute(LAZY_SRC_ATTR)
  image.removeAttribute(LAZY_SIZE_ATTR)
  image.setAttribute(LAZY_DONE_ATTR, '1')
  image.removeAttribute('title')
  for (const property of ['height', 'maxWidth', 'objectFit', 'cursor', 'borderRadius']) {
    image.style.removeProperty(property.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`))
  }
  image.setAttribute('src', src)
}

/**
 * Следить за перепиской и откладывать вложения в экономном режиме.
 * @returns функция очистки.
 */
function installLazyMedia() {
  const containerOf = () => document.querySelector('[data-conversation-content]')

  /** Пройтись по переписке: свернуть новые картинки, вернуть старые в обычном режиме. */
  const scan = () => {
    const container = containerOf()
    if (container === null) return
    if (!isEconomyMode()) {
      for (const image of container.querySelectorAll(`img[${LAZY_SRC_ATTR}]`)) lazyUnfold(image)
      return
    }
    for (const image of container.querySelectorAll('img')) {
      if (isLazyCandidate(image)) lazyFold(image)
    }
  }

  // Клик по плашке — единственный способ загрузить файл.
  const onClick = (event) => {
    const target = event.target
    if (!(target instanceof HTMLImageElement)) return
    if (!target.hasAttribute(LAZY_SRC_ATTR)) return
    event.preventDefault()
    event.stopPropagation()
    lazyUnfold(target)
  }

  scan()
  const timer = window.setInterval(scan, LAZY_SCAN_MS)
  document.addEventListener('click', onClick, true)
  window.addEventListener(MODE_CHANGE_EVENT, scan)

  return () => {
    clearInterval(timer)
    document.removeEventListener('click', onClick, true)
    window.removeEventListener(MODE_CHANGE_EVENT, scan)
    const container = containerOf()
    if (container !== null) {
      for (const image of container.querySelectorAll(`img[${LAZY_SRC_ATTR}]`)) lazyUnfold(image)
    }
  }
}
