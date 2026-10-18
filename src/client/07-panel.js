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
 * Немедленно применить позу панели.
 *
 * Назначается {@link installPanelState}; до установки слоя делать нечего.
 *
 * Позу пересчитывают наблюдатель и страховочный интервал, то есть с задержкой до
 * полусекунды. Открытию и закрытию по тапу ждать нельзя: человек успевал нажать
 * кнопку ещё раз, пока панель не уехала, и второй тап попадал по ещё открытой
 * панели. Поэтому кнопка и закрытие применяют позу сами.
 */
let applyPanelGeometry = () => {}

/**
 * Переключить панель штатной кнопкой harness.
 *
 * Панель умеет прятаться так, что штатная кнопка перестаёт существовать.
 * Тогда снять затемнение обязан сам слой: закрыть панель иначе нечем, и
 * экран остался бы заблокированным.
 *
 * Кнопка слоя — единственный способ снова показать панель, поэтому именно она
 * снимает {@link panelClosedByLayer}. Флаг harness при этом может говорить
 * «развёрнута» (его вернула перерисовка после переключения чата): тогда
 * нажимать штатную кнопку нельзя — она свернула бы уже показанную панель, — и
 * достаточно просто снять наш флаг.
 */
function togglePanel() {
  const forced = panelClosedByLayer
  panelClosedByLayer = false
  // Новое открытие — новый жест: «карантин» предыдущего закрытия к нему не
  // относится, иначе первый же тап внутри снова открытой панели не закрыл бы её.
  lastCloseAt = 0
  // Панель возвращается этим же тапом, а не ближайшим пересчётом: иначе она
  // «не отвечает» на первое нажатие, и человек жмёт второй раз.
  applyPanelGeometry()
  const frame = document.querySelector("[class$='_frame']")
  const collapsedByHarness = frame !== null && frame.hasAttribute('data-sidebar-collapsed')
  // Флаг снят, панель по флагу harness развёрнута — она уже на экране.
  if (forced && !collapsedByHarness) return
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
 * Закрыта ли панель по решению слоя.
 *
 * Раньше здесь стоял «карантин» на 400 мс: панель держалась закрытой, пока
 * harness не перепишет свой флаг. На медленном телефоне этого окна не хватало:
 * перерисовка списка сессий возвращала `data-sidebar-collapsed=false` уже после
 * карантина, наш пересчёт видел «панель открыта» — и панель приезжала обратно
 * поверх только что открытого чата. Со стороны это выглядело как «тап по сессии
 * ничего не делает: остаётся тот же экран».
 *
 * Теперь это не таймер, а состояние: закрыли — значит закрыто, пока человек сам
 * не нажмёт кнопку слоя ({@link togglePanel}).
 */
let panelClosedByLayer = false

/**
 * Закрыть показанную панель.
 *
 * Панель уезжает только нашими инлайновыми стилями — штатную кнопку harness
 * здесь НЕ нажимаем, и это важно.
 *
 * Нажатие штатной кнопки переводит панель из развёрнутого состояния в рейл, а
 * вместе с ним React размонтирует развёрнутый список: строка сессии исчезает из
 * документа, и открытие, начатое этим же тапом, теряет ссылку на сессию. В
 * консоли это `Session reference "…" is released`, а на экране — вечное
 * «Loading history…»: телефон медленный, открытие ещё в полёте, список уже
 * размонтирован. На быстром клиенте гонка не видна, поэтому раньше казалось, что
 * «всё работает».
 *
 * Инлайновый `transform` перебивает и каскад, и флаг harness, а список при этом
 * остаётся смонтированным — открытие доходит до конца. Пересчёт геометрии
 * (см. {@link installPanelState}) применяет позу закрытой панели.
 *
 * Повторный вызов внутри одного жеста игнорируется — см. {@link lastCloseAt}.
 */
function closePanel() {
  const now = Date.now()
  if (now - lastCloseAt < PANEL_CLOSE_GUARD_MS) return
  lastCloseAt = now
  // Панель уезжает сразу и больше не возвращается, даже если harness ещё не
  // переписал свой флаг сворачивания.
  panelClosedByLayer = true
  // Уезжает именно этим вызовом: ближайший пересчёт мог быть через полсекунды,
  // и всё это время панель оставалась поверх выбранного чата.
  applyPanelGeometry()
  // Затемнение и его перехват тапов снимаем сразу: иначе слой полсекунды (до
  // ближайшего пересчёта) продолжал бы съедать нажатия по загруженному чату.
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
    target.closest(`${SESSION_ROW_SELECTOR}, [class$='_newSession'], [class$='_panelRow'], [class$='_triggerRow'], a[href]`) !== null
}

/** Тап пришёл по строке сессии? */
function isSessionRow(target) {
  return target instanceof Element && target.closest(SESSION_ROW_SELECTOR) !== null
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
    // Решение слоя важнее флага harness: см. {@link panelClosedByLayer}.
    const collapsed = panelClosedByLayer || (frame !== null && frame.hasAttribute('data-sidebar-collapsed'))
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
    // Колонки кадра фиксируем: панель на телефоне и так вынесена из раскладки
    // (position: fixed), но harness при открытии/сворачивании переписывает
    // `grid-template-columns` (280px ↔ 56px), и контент на кадр успевал
    // пересчитаться — со стороны это выглядело как «всё растянулось».
    if (frame !== null && frame.style.gridTemplateColumns !== MOBILE_GRID_COLUMNS) {
      frame.style.gridTemplateColumns = MOBILE_GRID_COLUMNS
    }
    // Внутренняя колонка панели и отступы её строк — тоже инлайново. Список
    // сессий harness перерисовывает при каждом переключении чата, и если в этот
    // момент класс колонки оказывается другим, правила слоя на кадр перестают
    // совпадать: строки успевают разъехаться на всю ширину и вернуться — со
    // стороны это выглядело как «границы меню разделяются и снова сдвигаются».
    //
    // Колонку ищем по строке с логотипом, а не по имени класса: после закрытия и
    // повторного открытия harness пересобирает панель, и класс `_quietBars`
    // пропадает (остаётся `_root`). Тогда инлайновые отступы попадали не тому
    // элементу — строки уезжали вправо, а содержимое вылезало за панель.
    const logoRow = side.querySelector("[class*='_logoRow']")
    const inner = logoRow?.parentElement ?? side.querySelector("[class*='_quietBars']") ?? side.firstElementChild
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
  // Тап по кнопке слоя и закрытие панели по тапу применяют позу сразу, не
  // дожидаясь наблюдателя: см. {@link applyPanelGeometry}.
  applyPanelGeometry = applyGeometry
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
  // Геометрию переставляем сразу, до отрисовки кадра, но только когда мутация
  // касается кадра или панели: при потоковом ответе мутации идут сотнями в
  // секунду, и пересчёт на каждую подвешивал телефон.
  const relevant = (records) => {
    const side = document.querySelector("[class$='_sidebarCol']")
    const frame = document.querySelector("[class$='_frame']")
    if (side === null) return false
    for (const record of records) {
      const target = record.target
      if (!(target instanceof Node)) continue
      if (side.contains(target) || (frame !== null && frame.contains(target))) return true
      if (target instanceof Element && target.querySelector?.("[class$='_sidebarCol']") != null) return true
    }
    return false
  }
  const observer = new MutationObserver((records) => {
    if (relevant(records)) applyGeometry()
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
  // Страховка от залипшего состояния: если затемнение осталось включённым, а
  // панель уже уехала (или наоборот), один пересчёт в полсекунды это исправит.
  // Иначе полноэкранное затемнение молча съедало бы все тапы — «интерфейс
  // завис», и переключиться по чатам было нельзя.
  const heartbeat = window.setInterval(apply, 500)

  return () => {
    observer.disconnect()
    window.removeEventListener('resize', schedule)
    window.removeEventListener('orientationchange', schedule)
    clearTimeout(settleTimer)
    clearInterval(heartbeat)
    applyPanelGeometry = () => {}
    root.removeAttribute(PANEL_ATTR)
  }
}
