// 06-viewport.js — высота кадра по видимой области и meta против зума.
function syncFrameHeight() {
  const root = document.documentElement
  const viewport = window.visualViewport
  if (viewport === undefined || viewport === null) {
    root.style.removeProperty(FRAME_HEIGHT_VAR)
    return
  }
  const visible = Math.round(viewport.height + viewport.offsetTop)
  const layout = Math.round(window.innerHeight)
  if (layout - visible < KEYBOARD_MIN_INSET) {
    root.style.removeProperty(FRAME_HEIGHT_VAR)
    return
  }
  root.style.setProperty(FRAME_HEIGHT_VAR, `${visible}px`)
}

/**
 * Следить за видимой областью.
 * @returns функция очистки.
 */
function installViewportTracking() {
  const viewport = window.visualViewport
  let scheduled = false
  // События идут пачками по нескольку за кадр: считаем не чаще одного раза.
  const onViewportChange = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      syncFrameHeight()
    })
  }

  window.addEventListener('resize', onViewportChange)
  window.addEventListener('orientationchange', onViewportChange)
  if (viewport !== undefined && viewport !== null) {
    viewport.addEventListener('resize', onViewportChange)
    viewport.addEventListener('scroll', onViewportChange)
  }
  syncFrameHeight()

  return () => {
    window.removeEventListener('resize', onViewportChange)
    window.removeEventListener('orientationchange', onViewportChange)
    if (viewport !== undefined && viewport !== null) {
      viewport.removeEventListener('resize', onViewportChange)
      viewport.removeEventListener('scroll', onViewportChange)
    }
    document.documentElement.style.removeProperty(FRAME_HEIGHT_VAR)
  }
}

/** Есть ли ключ в строке `content` у `<meta name="viewport">`. */
function hasViewportKey(content, key) {
  return new RegExp(`(^|[,;\\s])${key}\\s*=`, 'i').test(content)
}

/**
 * Дописать в `<meta name="viewport">` ключи против зума.
 *
 * Телефон увеличивает интерфейс в двух случаях: фокус попадает в поле с
 * шрифтом меньше 16px (лечится `maximum-scale=1`) и двойной тап по элементу
 * (лечится `touch-action: manipulation` в CSS). `maximum-scale=1` при этом
 * оставляет `initial-scale=1`, поэтому текст и вёрстка не уменьшаются.
 *
 * `interactive-widget=resizes-content` — штатный способ Chrome укоротить
 * layout viewport вместе с клавиатурой; Safari его игнорирует, и там работу
 * делает {@link syncFrameHeight}.
 *
 * @returns функция очистки.
 */
function installViewportMeta() {
  let meta = document.querySelector('meta[name="viewport"]')
  const created = meta === null
  if (created) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'viewport')
    meta.setAttribute('content', 'width=device-width, initial-scale=1')
    document.head.appendChild(meta)
  }
  const original = meta.getAttribute('content') ?? ''
  const keys = ['maximum-scale=1', 'interactive-widget=resizes-content']
  const prepared = original.trim().replace(/[,;]$/, '')
  const missing = keys.filter((key) => !hasViewportKey(prepared, key.split('=')[0]))
  if (missing.length > 0) {
    meta.setAttribute('content', [prepared, ...missing].filter((part) => part !== '').join(', '))
  }
  return () => {
    if (created) {
      meta.remove()
      return
    }
    meta.setAttribute('content', original)
  }
}
