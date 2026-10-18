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
   *
   * Раньше здесь же стоял запрет на повторный тап по списку, пока идёт
   * загрузка: тап гасился, а каждое гашение заново поднимало полосу загрузки
   * ({@link installSessionLoading}) — и выйти из этого состояния было нечем.
   * Загрузка истории на телефоне идёт секундами, поэтому через пару тапов экран
   * замирал насовсем: список виден, панель открыта, выбранный чат не
   * открывается. Теперь тап по строке доходит до React всегда, а потерянный
   * тап повторяет {@link armRescue}.
   */
  const onOutsidePress = (event) => {
    const target = event.target
    const inside = isInsidePanel(target)
    // Новый жест по другому месту отменяет прежнюю страховку тапа: см.
    // {@link armRescue}.
    if (!inside) cancelRescue()
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
   * Заголовок открытого чата. `null` — заголовка нет (новый чат): сверять нечего.
   *
   * Смена заголовка — единственный дешёвый признак того, что переключение
   * началось: harness ставит его сразу, ещё до того как подъедет история.
   */
  const currentChatTitle = () => {
    const crumbs = document.querySelector("[class$='_crumbs']")
    return crumbs === null ? null : (crumbs.textContent ?? '').trim()
  }

  /** Отложенное повторение тапа по строке сессии: см. {@link armRescue}. */
  let rescueTimer = 0
  let rescueTap = null

  const cancelRescue = () => {
    if (rescueTimer !== 0) {
      window.clearTimeout(rescueTimer)
      rescueTimer = 0
    }
    rescueTap = null
  }

  /**
   * Доовести тап по строке сессии до переключения.
   *
   * На телефоне тап по строке иногда не доходит до React: браузер отдаёт его
   * наведению (у строки есть карточка и бегущий заголовок), считает началом
   * прокрутки или не синтезирует `click` внутри списка. Снаружи это выглядит
   * так, будто чат открывается только со второго раза, — и человек
   * действительно жмёт второй раз, после чего всё работает.
   *
   * Поэтому повторяем ровно это: ждём {@link SESSION_TAP_RESCUE_MS} и, если
   * заголовок чата не сменился, нажимаем тот же узел программно. Настоящий
   * `click` отменяет страховку ({@link onDocumentClick}), так что при живом тапе
   * второго нажатия не будет.
   *
   * Панель до срабатывания не закрываем: строка должна остаться в разметке.
   */
  const armRescue = (target) => {
    const row = target instanceof Element ? target.closest(SESSION_ROW_SELECTOR) : null
    if (row === null) return
    const before = currentChatTitle()
    // Тап по уже открытому чату: переключаться некуда, повторять нечего. В
    // строке заголовок стоит вместе с пометкой статуса и временем, поэтому
    // сверяем по началу.
    if (before !== null && before !== '' &&
      (row.textContent ?? '').includes(before.slice(0, SESSION_TITLE_MATCH_MAX))) return
    cancelRescue()
    rescueTap = { element: target, row }
    rescueTimer = window.setTimeout(() => {
      rescueTimer = 0
      const tap = rescueTap
      rescueTap = null
      if (tap === null) return
      // Строку могли перерисовать: тогда жмём тот же узел, а если и он ушёл из
      // документа — саму строку.
      const element = tap.element.isConnected ? tap.element : tap.row
      if (!element.isConnected) return
      if (currentChatTitle() !== before) {
        // Переключение уже началось, а `click` до слоя не дошёл — закрываем
        // панель сами, иначе она осталась бы поверх открытого чата.
        closePanel()
        return
      }
      element.click()
    }, SESSION_TAP_RESCUE_MS)
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
      // Тап дошёл сам — повторное нажатие не нужно: см. {@link armRescue}.
      cancelRescue()
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
   * Для строки сессии закрытие по таймеру не годится: строка исчезла бы из
   * разметки раньше, чем до неё дошёл {@link armRescue}.
   */
  const onPanelPress = (event) => {
    const target = event.target
    if (!isInsidePanel(target)) return
    if (!isPanelNavigation(target)) return
    cancelPendingClose()
    if (isSessionRow(target)) {
      armRescue(target)
      return
    }
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
    cancelRescue()
    cancelPendingClose()
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
