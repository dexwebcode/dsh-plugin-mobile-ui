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
  /**
   * Гасить ли текущий жест по строке сессии.
   *
   * Решается на `pointerdown`/`touchstart` — то есть по состоянию ДО этого
   * жеста. Проверять признак загрузки в `click` нельзя: полоса ставит его на
   * `pointerup` того же жеста, и тогда гасился бы в том числе первый тап —
   * список переставал открывать чаты вовсе (проверено на живой сборке).
   */
  let swallowGesture = false

  const onOutsidePress = (event) => {
    const target = event.target
    const inside = isInsidePanel(target)
    swallowGesture = inside && isSessionRowTarget(target) && isSessionBusy()
    // Затемнение могло остаться включённым, когда панель уже уехала (например,
    // после возврата из настроек или перерисовки). Тогда этот слой молча съедал
    // бы все тапы — «ничего не нажимается». Поэтому: снимаем состояние и
    // пропускаем событие дальше, ничего не гася.
    if (!isPanelShown()) {
      if (document.documentElement.getAttribute(PANEL_ATTR) !== null) {
        document.documentElement.removeAttribute(PANEL_ATTR)
      }
      return
    }
    if (inside) return
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
   * Закрытие отложено на макрозадачу: сначала событие должно дойти до React и
   * переключить чат, и только потом панель уезжает. Раньше кнопка сворачивания
   * нажималась прямо в обработчике — панель перерисовывалась раньше, чем
   * доходил `click`, и переключение чата терялось: меню оставалось открытым, а
   * выбранный чат не открывался.
   */
  const deferClose = () => {
    cancelPendingClose()
    window.setTimeout(() => { closePanel() }, 0)
  }

  /**
   * Отложенное закрытие на случай, когда `click` по строке не приходит вовсе.
   *
   * Ждём дольше, чем браузер тратит на синтетический `click`: если пришёл
   * `click`, он отменит это закрытие и закроет панель сам — уже после того, как
   * тап дойдёт до React. Иначе панель уезжала раньше строки, строка исчезала из
   * разметки, и чат не открывался: полоса загрузки гасла на пустом экране.
   */
  let pendingClose = 0
  const cancelPendingClose = () => {
    if (pendingClose !== 0) {
      window.clearTimeout(pendingClose)
      pendingClose = 0
    }
  }

  const onDocumentClick = (event) => {
    const target = event.target
    if (isInsidePanel(target)) {
      // Тап внутри панели закрывает её только если он что-то открывает. Проверку
      // «панель показана» здесь не делаем: на медленном телефоне геометрия в
      // момент доставки `click` уже могла отстать, и тап по строке не закрывал
      // панель вовсе — чат менялся под ней, а экран оставался тем же.
      if (!isPanelNavigation(target)) return
      // Пока предыдущий чат ещё грузится, второй тап по списку harness не
      // переживает: открытие теряет ссылку на сессию (`Session reference …
      // is released`), и экран навсегда остаётся на «Loading history…». Такой
      // тап гасим — полоса загрузки уже показывает, что запрос в пути.
      if (swallowGesture) {
        swallowGesture = false
        event.preventDefault()
        event.stopPropagation()
        return
      }
      deferClose()
      return
    }
    if (!isPanelShown()) return
    cancelPendingClose()
    if (target instanceof Element && target.closest(`.${BUTTON_CLASS}`) !== null) return
    closePanel()
  }

  /**
   * Тап по строке сессии: страховка на случай, когда `click` до нас не дошёл.
   *
   * На части браузеров (и в установленном приложении) тап по элементу внутри
   * прокручиваемого списка не даёт `click` — тогда меню оставалось открытым.
   * Здесь закрытие ставится с задержкой и отменяется, если `click` всё же был.
   */
  const onPanelPress = (event) => {
    const target = event.target
    if (!isInsidePanel(target)) return
    if (!isPanelNavigation(target)) return
    // Гасим повторный тап по списку, пока идёт загрузка выбранного чата: см.
    // {@link onDocumentClick}. Панель в этом случае тоже не закрываем — иначе
    // выглядело бы, будто тап сработал, а чат остался прежним. Решение принято на
    // `pointerdown` (см. {@link swallowGesture}), поэтому здесь только читаем его.
    if (swallowGesture) return
    cancelPendingClose()
    pendingClose = window.setTimeout(() => {
      pendingClose = 0
      closePanel()
    }, PANEL_CLICK_FALLBACK_MS)
  }

  document.addEventListener('pointerdown', onOutsidePress, true)
  document.addEventListener('touchstart', onOutsidePress, { capture: true, passive: false })
  document.addEventListener('pointerup', onPanelPress, true)
  document.addEventListener('touchend', onPanelPress, true)
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
    document.removeEventListener('pointerup', onPanelPress, true)
    document.removeEventListener('touchend', onPanelPress, true)
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('click', onDocumentClick, true)
    if (button !== null && button.isConnected) button.remove()
    backdrop.remove()
  }
}
