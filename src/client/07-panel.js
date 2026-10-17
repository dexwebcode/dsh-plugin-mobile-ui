// 07-panel.js — геометрия панели, её переключение и состояние на корне документа.
function findToggle() {
  const panel = document.querySelector("[class$='_sidebarCol']")
  return panel === null ? null : panel.querySelector("[class$='_toggle']")
}

/**
 * Панель сейчас на экране?
 *
 * Одного атрибута `data-sidebar-collapsed` мало: он отражает намерение
 * harness, а не факт. Поэтому дополнительно смотрим на геометрию выдвинутой
 * панели — свёрнутая уезжает за левый край на свою ширину.
 */
function isPanelShown() {
  const panel = document.querySelector("[class$='_sidebarCol']")
  if (panel === null) return false
  const style = window.getComputedStyle(panel)
  if (style.visibility === 'hidden' || style.display === 'none') return false
  const rect = panel.getBoundingClientRect()
  // Пустой прямоугольник — панель спрятана предком: собственный `display` у неё
  // при этом обычный, а геометрия нулевая, и порог по `left` дал бы «показана».
  if (rect.width <= 0 || rect.height <= 0) return false
  return rect.left > -PANEL_VISIBLE_LEFT_PX
}

/**
 * Переключить панель штатной кнопкой harness.
 *
 * Панель умеет прятаться так, что штатная кнопка перестаёт существовать.
 * Тогда снять затемнение обязан сам слой: закрыть панель иначе нечем, и
 * экран остался бы заблокированным.
 */
function togglePanel() {
  // Новое открытие отменяет недавний запрос на закрытие: иначе панель осталась
  // бы закрытой до конца «карантина».
  panelCloseRequestedAt = 0
  const control = findToggle()
  if (control !== null) {
    control.click()
    return
  }
  document.documentElement.removeAttribute(PANEL_ATTR)
}

/**
 * Когда панель закрывали в последний раз.
 *
 * Один тап приходит несколькими событиями — `touchstart`, `pointerdown` и
 * `click`, — и каждое просит закрыть панель. Закрытие сводится к нажатию
 * штатной кнопки, то есть к переключению: второе нажатие на тот же тап
 * возвращает панель обратно. Снаружи это выглядит как мигание панели, при
 * котором вдобавок ничего не нажимается — тап к тому же погашен.
 */
let lastCloseAt = 0

/**
 * До какого момента панель считается закрытой независимо от состояния harness.
 *
 * Тап по строке сессии закрывает панель нажатием штатной кнопки, но harness
 * успевает перерисовать список (активная строка) раньше, чем переключит свой
 * флаг: наш пересчёт видел «панель открыта» и возвращал её на место — со стороны
 * это выглядело как повторный сдвиг границ меню перед переключением чата. Пока
 * идёт такой запрос на закрытие, панель держим закрытой.
 */
let panelCloseRequestedAt = 0

/**
 * Закрыть показанную панель.
 *
 * Отдельно от {@link togglePanel} по смыслу: вызывать её можно только когда
 * панель на экране, иначе штатная кнопка откроет её вместо закрытия. Повторный
 * вызов внутри одного жеста игнорируется — см. {@link lastCloseAt}.
 */
function closePanel() {
  const now = Date.now()
  if (now - lastCloseAt < PANEL_CLOSE_GUARD_MS) return
  lastCloseAt = now
  // Панель уезжает сразу и больше не возвращается, даже если harness ещё не
  // переписал свой флаг сворачивания.
  panelCloseRequestedAt = now + PANEL_CLOSE_GUARD_MS
  const control = findToggle()
  if (control !== null) {
    control.click()
    return
  }
  document.documentElement.removeAttribute(PANEL_ATTR)
}

/**
 * Тап меняет то, что видно за панелью: чат, панель или диалог настроек.
 *
 * Такой тап закрывает панель. Одной строки сессии мало: «New Session» создаёт
 * чат, «Plugins» открывает панель, «Settings» — диалог, и во всех трёх случаях
 * выдвинутая панель оставалась поверх только что открытого экрана.
 */
function isPanelNavigation(target) {
  return target instanceof Element &&
    target.closest("[class$='_sessionRow'], [class$='_newSession'], [class$='_panelRow'], [class$='_triggerRow'], a[href]") !== null
}

/** Тап пришёл по самой панели? Тогда закрывать нечего. */
function isInsidePanel(target) {
  const panel = document.querySelector("[class$='_sidebarCol']")
  return panel !== null && target instanceof Node && panel.contains(target)
}

/**
 * Держать на корне документа состояние «панель на экране».
 *
 * По этому состоянию включается затемнение, поэтому оно обязано совпадать с
 * реальностью, а не с намерением harness: смотрим на разметку панели и на
 * смену раскладки.
 *
 * @returns функция очистки.
 */
function installPanelState() {
  // См. {@link installDrawer}: на широком экране состояние панели не считаем —
  // иначе слой вешает на корень документа `data-dsh-mobile-panel`, по которому
  // включается затемнение, и начинает спорить с раскладкой harness.
  if (!isNarrow()) return () => {}

  const root = document.documentElement
  let scheduled = false
  let scheduledAt = 0
  let lastRun = 0
  let settleTimer = null

  /**
   * Задать панели геометрию инлайновыми стилями.
   *
   * Правила слоя — обычный CSS, и если на устройстве какое-то из них не
   * применилось, панель возвращалась к штатной ширине и «схлопывалась» до рейла
   * (56px) при нажатии на кнопку сворачивания — со стороны это выглядело как
   * закрытие в два шага. Инлайновые стили перебивают таблицы стилей, поэтому
   * открытие и закрытие теперь не зависят от каскада.
   */
  const applyGeometry = () => {
    const side = document.querySelector("[class$='_sidebarCol']")
    if (side === null) return
    const frame = document.querySelector("[class$='_frame']")
    // Запрос на закрытие важнее флага harness: см. {@link panelCloseRequestedAt}.
    const closing = Date.now() < panelCloseRequestedAt
    const collapsed = closing || (frame !== null && frame.hasAttribute('data-sidebar-collapsed'))
    // Та же ширина, что и в CSS: правый край проходит между «+» и «⋮», поэтому
    // в полосе справа видно только «⋮».
    const width = Math.min(window.innerWidth - 56, 420)
    const style = side.style
    style.position = 'fixed'
    style.top = '0'
    style.bottom = '0'
    style.left = '0'
    style.width = `${Math.max(width, 280)}px`
    style.zIndex = '60'
    style.transition = 'transform 0.26s cubic-bezier(0.4, 0, 0.2, 1), visibility 0.26s'
    style.transform = collapsed ? 'translateX(-105%)' : 'none'
    style.visibility = collapsed ? 'hidden' : 'visible'
    // Внутренняя колонка панели и отступы её строк — тоже инлайново. Список
    // сессий harness перерисовывает при каждом переключении чата, и если в этот
    // момент класс колонки оказывается другим, правила слоя на кадр перестают
    // совпадать: строки успевают разъехаться на всю ширину и вернуться — со
    // стороны это выглядело как «границы меню разделяются и снова сдвигаются».
    const inner = side.querySelector("[class*='_quietBars']") ?? side.firstElementChild
    if (inner !== null) {
      inner.style.width = '100%'
      inner.style.paddingLeft = '2px'
      inner.style.paddingRight = '2px'
      for (const child of inner.children) {
        const logo = String(child.className ?? '').includes('_logoRow')
        const inset = logo ? '0px' : '20px'
        if (child.style.marginLeft !== inset) child.style.marginLeft = inset
        if (child.style.marginRight !== inset) child.style.marginRight = inset
      }
    }
  }

  const apply = () => {
    scheduled = false
    lastRun = Date.now()
    applyGeometry()
    const open = isNarrow() && isPanelShown()
    const next = open ? 'open' : null
    if (root.getAttribute(PANEL_ATTR) !== next) {
      if (next === null) root.removeAttribute(PANEL_ATTR)
      else root.setAttribute(PANEL_ATTR, next)
    }
  }
  // Панель появляется в разметке не мгновенно: считаем состояние по кадру,
  // чтобы не поймать ещё пустой документ.
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    scheduledAt = Date.now()
    const wait = Math.max(0, PANEL_STATE_MIN_INTERVAL_MS - (scheduledAt - lastRun))
    if (wait === 0) requestAnimationFrame(apply)
    else window.setTimeout(() => requestAnimationFrame(apply), wait)
    // Панель выезжает 260мс, и сразу после смены класса геометрия ещё старая:
    // разовый пересчёт увидел бы «закрыто» и на этом остановился — затемнение
    // не включалось до следующей случайной перерисовки. Поэтому пересчитываем
    // ещё раз, когда анимация заведомо закончилась.
    clearTimeout(settleTimer)
    settleTimer = window.setTimeout(() => requestAnimationFrame(apply), PANEL_SETTLE_MS)
  }

  // Наблюдаем весь документ: панель и её атрибуты появляются и меняются в
  // любой момент, а привязка к конкретным узлам ломается при их пересоздании.
  //
  // Геометрию переставляем сразу, до отрисовки кадра: harness может переписать
  // ширину панели своим инлайновым стилем (при открытии и закрытии он меняет
  // раскладку кадра), и если ждать троттлинг, панель на кадр-другой «прыгала» к
  // штатному размеру — со стороны это выглядело как скачок краёв при выдвижении.
  const observer = new MutationObserver(() => {
    applyGeometry()
    schedule()
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class', 'data-sidebar-collapsed'],
    childList: true,
    subtree: true,
  })
  window.addEventListener('resize', schedule)
  window.addEventListener('orientationchange', schedule)
  schedule()

  return () => {
    observer.disconnect()
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', schedule)
    clearTimeout(settleTimer)
    root.removeAttribute(PANEL_ATTR)
  }
}
