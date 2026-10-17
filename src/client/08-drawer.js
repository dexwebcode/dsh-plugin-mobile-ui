// 08-drawer.js — кит-кнопка в шапке, затемнение и обработчики нажатий.
function installDrawer() {
  // Слой выдвижной панели существует только на телефоне. На широком экране
  // панель harness стоит в раскладке и видна всегда — и тогда
  // {@link isPanelShown} отвечает «показана» на каждом нажатии: обработчики
  // ниже принимали любой клик за «нажатие вне панели» и сворачивали её. Панель
  // уезжала, harness возвращал её назад, следующий клик повторял цикл — со
  // стороны это выглядит как «страница дёргается и не нажимается» (проверено на
  // живой сборке: `data-sidebar-collapsed` мигал каждые ~300мс).
  if (!isNarrow()) return () => {}

  let button = null

  // Кит живёт в шапке, а шапку React рисует не сразу: в момент запуска слоя её
  // может ещё не быть. Поэтому кнопку ставим лениво — сразу, если шапка уже
  // есть, иначе по факту её появления (наблюдатель в конце функции).
  const ensureButton = () => {
    if (button !== null && button.isConnected) return button
    button = document.querySelector(`.${BUTTON_CLASS}`)
    if (button === null) {
      const header = document.querySelector(HEADER_SELECTOR)
      if (header === null) {
        button = null
        return null
      }
      button = document.createElement('button')
      button.className = BUTTON_CLASS
      button.type = 'button'
      button.title = 'Меню'
      button.setAttribute('aria-label', 'Открыть панель')
      button.addEventListener('click', togglePanel)
      header.appendChild(button)
    }
    // Логотип ставим и в уже существующей кнопке: при перезагрузке плагина
    // элемент остаётся в документе, а разметка могла остаться прежней.
    button.innerHTML = WHALE_BUTTON_SVG
    return button
  }

  let backdrop = document.querySelector(`.${BACKDROP_CLASS}`)
  if (backdrop === null) {
    backdrop = document.createElement('div')
    backdrop.className = BACKDROP_CLASS
    backdrop.setAttribute('aria-hidden', 'true')
    document.body.appendChild(backdrop)
  }

  /**
   * Нажатие вне панели закрывает её.
   *
   * Слушаем `pointerdown` и `touchstart` прямо на документе и в фазе
   * перехвата: `click` на телефоне может не прийти вовсе, а тогда затемнение
   * висело бы до перезагрузки. Реагируем раньше содержимого, чтобы тап не
   * успел сработать как нажатие по тому, что из-под панели видно.
   *
   * Внутри панели нажатие НЕ закрывает её — даже по строке сессии. Закрытие
   * сводится к нажатию штатной кнопки, панель уезжает из-под пальца, и `click`
   * достаётся уже другому элементу: переключение чата не срабатывало (проверено
   * настоящим тачем). Навигация закрывает панель по `click` — см.
   * {@link onDocumentClick}, где тап уже доставлен строке.
   */
  const onOutsidePress = (event) => {
    if (!isPanelShown()) return
    const target = event.target
    if (isInsidePanel(target)) return
    if (target instanceof Element && target.closest(`.${BUTTON_CLASS}`) !== null) return
    event.preventDefault()
    event.stopPropagation()
    closePanel()
  }

  /** Поле ввода под панелью: фокус в него закрывает панель. */
  const onFocusIn = (event) => {
    if (!isPanelShown()) return
    const target = event.target
    if (isInsidePanel(target)) return
    if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]') === null) return
    closePanel()
  }

  /**
   * `click` дообрабатывает то, что не должен трогать `pointerdown`: закрытие
   * панели по тапу на строку сессии или на ссылку.
   *
   * Здесь это безопасно: адресат `click` уже вычислен, поэтому панель можно
   * убирать — событие всё равно дойдёт до React и переключит чат. Именно
   * поэтому закрытие на навигации живёт здесь, а не в {@link onOutsidePress}.
   */
  const onDocumentClick = (event) => {
    if (!isPanelShown()) return
    const target = event.target
    if (isInsidePanel(target)) {
      if (isPanelNavigation(target)) closePanel()
      return
    }
    if (target instanceof Element && target.closest(`.${BUTTON_CLASS}`) !== null) return
    closePanel()
  }

  document.addEventListener('pointerdown', onOutsidePress, true)
  document.addEventListener('touchstart', onOutsidePress, { capture: true, passive: false })
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('click', onDocumentClick, true)

  ensureButton()
  // Шапка может перерисоваться (React меняет разметку) и унести кнопку с собой —
  // тогда возвращаем её на место.
  const observer = new MutationObserver(() => {
    if (button === null || !button.isConnected) ensureButton()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    document.removeEventListener('pointerdown', onOutsidePress, true)
    document.removeEventListener('touchstart', onOutsidePress, true)
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('click', onDocumentClick, true)
    if (button !== null && button.isConnected) button.remove()
    backdrop.remove()
  }
}
