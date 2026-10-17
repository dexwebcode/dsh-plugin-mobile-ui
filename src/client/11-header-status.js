// 11-header-status.js — плашка с живым этапом работы в шапке.
/** Свести служебный текст к одной строке и убрать точки-анимацию в конце. */
function normalizeStatusText(raw) {
  return String(raw ?? '')
    .replace(/\s+/gu, ' ')
    .replace(/[\s·…]+$/gu, '')
    .trim()
}

function installHeaderStatus() {
  let slot = null
  let textNode = null
  let labelNode = null

  const narrow = () => window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`).matches

  const ensure = () => {
    if (slot !== null && slot.isConnected) return slot
    const header = document.querySelector(HEADER_SELECTOR)
    if (header === null) return null
    slot = document.createElement('div')
    slot.className = STATUS_CLASS
    slot.setAttribute('aria-hidden', 'true')
    textNode = document.createElement('span')
    textNode.className = `${STATUS_CLASS}-run`
    // Текст живёт в отдельном узле: у него свой `text-overflow`, поэтому
    // длинный этап обрезается многоточием, а точка-индикатор остаётся целой.
    labelNode = document.createElement('span')
    labelNode.className = `${STATUS_CLASS}-label`
    textNode.append(labelNode)
    slot.append(textNode)
    header.appendChild(slot)
    return slot
  }

  /**
   * Текущий инструмент: «Edit · 11-header-status.js».
   *
   * Активный вызов harness помечает `data-state="running"`; внутри у него есть
   * готовые название (`_title`) и подпись (`_summary`) — путь файла, команда,
   * запрос. Ничего не досчитываем сами.
   */
  const readRunningTool = () => {
    const tools = [...document.querySelectorAll(RUNNING_TOOL_SELECTOR)].filter(isVisible)
    if (tools.length === 0) return ''
    const tool = tools[tools.length - 1]
    const title = normalizeStatusText(tool.querySelector(TOOL_TITLE_SELECTOR)?.textContent)
    // У «Write» и «Edit» подписи `_summary` нет: путь файла лежит в ссылке.
    const detail = tool.querySelector(TOOL_SUMMARY_SELECTOR) ?? tool.querySelector(TOOL_FILE_SELECTOR)
    const summary = normalizeStatusText(detail?.textContent)
    if (title === '') return summary
    return summary === '' ? title : `${title} · ${summary}`
  }

  /**
   * Текст живой строки хода: «Deep diving for 6m 38s».
   *
   * Harness рисует её в конце переписки (`data-chat-running`), и существует она
   * только пока сессия работает. Служебные точки в конце — анимация, в плашке
   * они не нужны.
   */
  const readRunningStage = () => {
    const running = [...document.querySelectorAll(RUNNING_SELECTOR)].filter(isVisible)
    if (running.length === 0) return ''
    const node = running[running.length - 1]
    const label = node.querySelector(RUNNING_LABEL_SELECTOR) ?? node
    return normalizeStatusText(label.textContent)
  }

  /** Счётчики из шапки — то, что на десктопе стоит справа от режима работы. */
  const readHeaderCounters = () => {
    const header = document.querySelector(HEADER_SELECTOR)
    if (header === null) return ''
    return [...header.querySelectorAll(HEADER_COUNTER_SELECTOR)]
      .map((el) => normalizeStatusText(el.textContent))
      .filter((part) => part !== '')
      .join(' · ')
  }

  const render = () => {
    // Слот существует только на узком экране: на широком он остался бы без
    // стилей, потому что живёт внутри медиазапроса.
    if (!narrow()) {
      if (slot !== null) slot.remove()
      slot = null
      return
    }
    if (ensure() === null) return
    // Сначала — инструмент, который работает прямо сейчас; между вызовами
    // показываем живой этап хода, затем счётчики шапки. Заглушку («Running») не
    // пишем: слово, которое ничего не сообщает, вместо этапа только мешает.
    const tool = readRunningTool()
    const stage = readRunningStage()
    const next = tool !== '' ? tool : stage !== '' ? stage : readHeaderCounters()
    // Пусто — плашки нет совсем: в шапке остаются только кнопки.
    slot.style.display = next === '' ? 'none' : ''
    // Пишем только когда текст реально меняется: ниже стоит MutationObserver,
    // и если записывать то же значение, он снова вызовет render — вечный цикл.
    if (labelNode.textContent !== next) labelNode.textContent = next
  }

  render()
  // Разметка в живом чате меняется непрерывно: этап и его длительность
  // перерисовываются каждую секунду, поэтому наблюдаем за всем документом.
  const observer = new MutationObserver(render)
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  window.addEventListener('resize', render)
  window.addEventListener('orientationchange', render)

  return () => {
    observer.disconnect()
    window.removeEventListener('resize', render)
    window.removeEventListener('orientationchange', render)
    if (slot !== null) slot.remove()
    slot = null
  }
}
