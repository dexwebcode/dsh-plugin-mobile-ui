// 12-stats-dock.js — полоса статистики: подъём наверх, замер высоты и своя полоса.
function installStatsDock() {
  const root = document.documentElement
  let empty = null
  let template = ''
  let builtFrom = null
  let builtText = null

  /** Живая полоса harness: есть в разметке или нет. */
  const liveStrip = () => document.querySelector(STATS_ROOT_SELECTOR)

  /**
   * Полоса реально видна в верхней строке экрана.
   *
   * Присутствия в разметке мало: harness может отрисовать полосу и спрятать её
   * (док `display: none` в момент загрузки сессии), а CSS-подъём может не
   * сработать — тогда полоса остаётся внизу за полем ввода. Отдельная беда —
   * полоса на своём месте в разметке, но **накрыта шапкой**: если отступ кадра
   * сверху не применился, шапка стоит в тех же 0..26px и закрывает её. Прямоугольник
   * при этом правильный, и проверка по координатам говорит «видна», хотя на
   * экране её нет. Поэтому в конце — проверка попаданием: в центре полосы должен
   * оказаться сам элемент полосы, а не шапка.
   */
  const stripVisible = () => {
    const live = liveStrip()
    if (live === null) return false
    const rect = live.getBoundingClientRect()
    if (rect.width < 8 || rect.height < 8) return false
    // Отрицательный top — полоса уехала выше экрана; это тоже «не видна».
    if (rect.top < -2 || rect.top > 8) return false
    const style = getComputedStyle(live)
    if (style.display === 'none' || style.visibility === 'hidden') return false
    const x = Math.round(rect.left + Math.min(rect.width / 2, 40))
    const y = Math.round(rect.top + rect.height / 2)
    // Свою полосу из проверки исключаем: она лежит поверх и с z-index 200
    // перехватила бы попадание — тогда получился бы замкнутый круг «своя
    // полоса видна, значит живая не видна, значит показываем свою».
    const stack = document.elementsFromPoint(x, y)
    const first = stack.find((el) => !(empty !== null && empty.contains(el)))
    if (first === undefined) return false
    return first === live || live.contains(first) || first.contains(live)
  }

  /** Текст живой полосы: по нему видно, что значения обновились. */
  const liveStripText = () => {
    const live = liveStrip()
    return live === null ? null : String(live.textContent ?? '').replace(/\s+/gu, ' ').trim()
  }

  /**
   * Запомнить разметку живой полосы.
   *
   * Клонируется весь док, а не только блок статистики: третья ячейка полосы —
   * индикатор занятой памяти — живёт рядом с ним, отдельным элементом.
   */
  const rememberTemplate = () => {
    if (liveStrip() === null) return
    const dock = document.querySelector(DOCK_SELECTOR)
    if (dock !== null) template = dock.outerHTML
  }

  /**
   * Собрать свою полосу.
   *
   * Клон живой полосы сохраняет родные классы, иконки и вёрстку. Если живой
   * полосы нет (новый чат), числа в подписях заменяются нулями; если она есть,
   * но не видна, значения оставляем настоящими — человеку нужны цифры, а не
   * нули. Совсем без живой полосы показываем запасной текст.
   *
   * @param keepValues - сохранять числа живой полосы, а не обнулять их.
   */
  const buildEmpty = (keepValues) => {
    if (template === '') {
      const fallback = document.createElement('div')
      fallback.className = `${EMPTY_STATS_CLASS} ${EMPTY_STATS_BAR_CLASS}`
      fallback.setAttribute('aria-hidden', 'true')
      fallback.innerHTML = EMPTY_STATS_HTML
      return fallback
    }
    const holder = document.createElement('div')
    holder.innerHTML = template
    const bar = holder.firstElementChild
    if (bar === null) return buildEmpty(keepValues)
    bar.classList.add(EMPTY_STATS_BAR_CLASS)
    bar.setAttribute('aria-hidden', 'true')
    // Клон не должен выглядеть живой полосой для собственного поиска.
    for (const marked of bar.querySelectorAll(STATS_ROOT_SELECTOR)) {
      marked.removeAttribute('data-composer-stats')
    }
    bar.removeAttribute('data-composer-stats')
    if (!keepValues) {
      // Числа — в нули: в новом чате шагов и токенов ещё нет.
      const walker = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent !== null && /\d/u.test(node.textContent)) {
          node.textContent = node.textContent.replace(STATS_NUMBER_PATTERN, '0')
        }
      }
      // Кольцо памяти скопировалось бы заполненным на прошлый процент: раз в
      // подписи ноль, заливку убираем — остаётся пустая дорожка.
      for (const fill of bar.querySelectorAll("[class$='_fill']")) fill.remove()
    }
    // Клон — картинка, а не орган управления: обработчиков у него нет.
    for (const el of bar.querySelectorAll('*')) {
      for (const name of ['aria-label', 'aria-haspopup', 'aria-expanded', 'tabindex', 'role']) {
        el.removeAttribute(name)
      }
    }
    for (const button of bar.querySelectorAll('button')) {
      button.disabled = true
      button.setAttribute('tabindex', '-1')
    }
    return bar
  }

  /**
   * Показать или убрать свою полосу.
   * @param show - нужна ли своя полоса.
   * @param text - текст живой полосы (null, если её нет): по нему клон
   *   пересобирается, когда значения меняются.
   */
  const syncEmpty = (show, text) => {
    if (!show) {
      if (empty !== null) empty.style.display = 'none'
      return
    }
    if (empty === null || builtFrom !== template || builtText !== text) {
      const next = buildEmpty(text !== null)
      if (empty !== null) empty.replaceWith(next)
      else document.body.appendChild(next)
      empty = next
      builtFrom = template
      builtText = text
      applyBarStyles(empty)
    }
    empty.style.display = ''
    applyBarStyles(empty)
  }

  /**
   * Поднять док полосы наверх, если CSS до него не достал.
   *
   * Правило в стилях ищет док по суффиксу класса. Если у дока в текущем
   * состоянии оказался ещё один класс (или он вложен иначе), правило не
   * срабатывает, и полоса остаётся внизу — то есть её не видно. Здесь тот же
   * подъём делается напрямую: сначала проверяем, что полоса правда не наверху.
   */
  const liftDock = () => {
    const live = liveStrip()
    if (live === null) return null
    if (live.getBoundingClientRect().top <= 4) return null
    let dock = live.parentElement
    while (dock !== null && !String(dock.className ?? '').includes('_dock')) dock = dock.parentElement
    if (dock === null) return null
    dock.style.position = 'fixed'
    dock.style.top = '0'
    dock.style.left = '0'
    dock.style.right = '0'
    dock.style.zIndex = '50'
    dock.style.padding = '0 16px'
    dock.style.background = 'var(--dsw-alias-bg-base, #fff)'
    return dock
  }

  // Когда живой полосы не видно, помним с какого момента: короткая пауза при
  // загрузке чата не должна подменять полосу нулями.
  let missingSince = 0

  /** Высота полосы: из переменной замера, иначе штатные 26px. */
  const barHeight = () => {
    const measured = Number.parseFloat(getComputedStyle(root).getPropertyValue(DOCK_HEIGHT_VAR))
    return Number.isFinite(measured) && measured >= 20 ? Math.round(measured) : 26
  }

  /**
   * Жёстко задать геометрию своей полосы инлайновыми стилями.
   *
   * Стили слоя — обычные правила в `<style>`: если на устройстве какое-то из них
   * не применилось (непонятный синтаксис, чужая тема перебила каскад), полоса
   * молча исчезала. Инлайновые стили перебивают таблицы стилей, поэтому здесь
   * дублируется всё, без чего полосу не видно.
   *
   * @param bar - элемент своей полосы.
   */
  const applyBarStyles = (bar) => {
    const style = bar.style
    style.position = 'fixed'
    style.top = '0'
    // По 22px от краёв экрана: левый край полосы совпадает с левым краем кита
    // (20px) и вкладки «Chat» (25px), правый отступает на столько же.
    style.left = `${STATS_BAR_INSET_PX}px`
    style.right = `${STATS_BAR_INSET_PX}px`
    style.height = `${barHeight()}px`
    // Внутренние поля маленькие: цифры встают на ту же вертикаль, что и «Chat».
    style.boxSizing = 'border-box'
    style.padding = '0 3px'
    // Ниже затемнения (55) и панели (60): открытое меню перекрывает полосу, а не
    // наоборот. Полоса при этом остаётся поверх контента чата.
    style.zIndex = '50'
    style.display = 'flex'
    style.alignItems = 'center'
    style.overflow = 'hidden'
    style.borderRadius = '6px'
    style.background = 'var(--dsw-alias-bg-base, #fff)'
    // Полоса только показывает цифры: тапы проходят сквозь неё к живой полосе
    // harness, поэтому плашки-подсказки по-прежнему открываются.
    style.pointerEvents = 'none'
  }

  /**
   * Освободить место полосе в кадре — тоже инлайново.
   *
   * По этому отступу шапка уезжает вниз. Если положиться только на правило в
   * стилях, при его сбое шапка остаётся на месте и накрывает полосу.
   *
   * @param height - сколько места нужно; 0 — убрать отступ.
   */
  const setFramePadding = (height) => {
    const frame = document.querySelector("[class$='_frame']")
    if (frame === null) return
    if (height > 0) frame.style.paddingTop = `${height}px`
    else frame.style.removeProperty('padding-top')
  }

  const measure = () => {
    if (!isNarrow()) {
      syncEmpty(false, null)
      missingSince = 0
      setFramePadding(0)
      root.style.removeProperty(DOCK_HEIGHT_VAR)
      return
    }
    rememberTemplate()
    liftDock()
    // Своя полоса показывается ВСЕГДА, а живая под ней просто живёт. Почему так:
    // живая полоса может быть на месте в разметке и при этом не видна человеку —
    // её накрывает шапка, её обрезает предок, она оказывается за краем. Проверки
    // видимости ловят не все такие случаи, а цена ошибки — пустая строка сверху.
    // Своя полоса лежит поверх (z-index 200) и не зависит ни от каскада, ни от
    // соседей; значения берутся из живой и обновляются вместе с ней.
    const text = liveStripText()
    syncEmpty(true, text)
    missingSince = 0
    setFramePadding(barHeight())

    const dock = document.querySelector(DOCK_SELECTOR)
    if (dock === null) {
      root.style.removeProperty(DOCK_HEIGHT_VAR)
      return
    }
    const height = Math.round(dock.getBoundingClientRect().height)
    // Ноль означает, что док ещё не разложен. Записать его в переменную значит
    // спрятать и полосу, и место под неё: держим прошлое значение.
    if (height >= 20) root.style.setProperty(DOCK_HEIGHT_VAR, `${height}px`)
    setFramePadding(barHeight())
  }

  measure()
  // Полоса появляется и исчезает вместе с данными сессии, а её высота — вместе
  // с шириной экрана. Опрос раз в секунду дешевле наблюдателя за всем деревом.
  const timer = window.setInterval(measure, 1000)
  window.addEventListener('resize', measure)
  window.addEventListener('orientationchange', measure)

  return () => {
    clearInterval(timer)
    window.removeEventListener('resize', measure)
    window.removeEventListener('orientationchange', measure)
    if (empty !== null) empty.remove()
    empty = null
    root.style.removeProperty(DOCK_HEIGHT_VAR)
  }
}
