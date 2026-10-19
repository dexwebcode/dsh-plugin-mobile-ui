// 10-header-menu.js — пункты Relay и «открыть в проводнике» в меню «⋮».
const MORE_ACTIONS_SELECTOR = '[aria-label="More actions"]'

/** Шапка сессии. `*=` ловит и пустую шапку (`_headerBlank`), где суффикс не последний. */
const HEADER_SELECTOR = 'header[class*="_header"]'

/** Штатный счётчик фоновых задач — источник статуса. */
const HEADER_ACTIONS_SELECTOR = "[class$='_headerActions']"

/** Штатная кнопка «открыть в проводнике» — иконка с папкой слева от «⋮». */
const EXPLORER_SELECTOR = '[aria-label="Open in File Explorer"]'

/** Ссылка Relay: её рисует отдельный плагин, id стабилен. */
const RELAY_LINK_ID = 'dsh-relay-link'

/** Метка на пункте меню, который добавил этот слой. */
const MENU_ITEM_ATTR = 'data-dsh-plugin-mobile-ui-menu-item'

/** Виден ли элемент: свёрнутая панель и закрытые меню дают нулевой прямоугольник. */
function isVisible(element) {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden'
}

/**
 * Меню, в которое можно подмешать пункты.
 *
 * Берём последнее видимое `role="menu"`: попапы уезжают в конец `body`, поэтому
 * последнее — то, что только что открылось.
 */
function findOpenMenu() {
  const menus = [...document.querySelectorAll('[role="menu"]')].filter(isVisible)
  return menus.length === 0 ? null : menus[menus.length - 1]
}

/** Закрыть открытые меню: «Escape» — штатный для них жест. */
function closeOpenMenus() {
  for (const menu of document.querySelectorAll('[role="menu"]')) {
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
}

/** Выполнить действие переехавшего пункта: нажимаем ту самую штатную кнопку. */
function runHeaderAction(kind) {
  const target = kind === 'relay'
    ? document.getElementById(RELAY_LINK_ID)
    : document.querySelector(EXPLORER_SELECTOR)
  closeOpenMenus()
  if (target === null) return
  // Штатная кнопка прячется через `display: none`, но обработчик у неё живой:
  // программный `click` доходит до React так же, как настоящий.
  target.click()
}

/**
 * Собрать пункт меню из штатного шаблона.
 *
 * Клонируем готовую обёртку вместе с кнопкой: так пункт приезжает с родными
 * классами, отступами и иконкой. Меняем только подпись и картинку.
 */
function buildMenuItem(template, source) {
  const wrap = template.parentElement?.cloneNode(true)
  if (wrap === undefined || wrap === null) return null
  const button = wrap.querySelector('[role="menuitem"]')
  if (button === null) return null

  button.setAttribute(MENU_ITEM_ATTR, source.kind)
  const icon = button.querySelector('[class*="_itemIcon"]')
  if (icon !== null) {
    icon.replaceChildren()
    if (source.icon !== null) icon.appendChild(source.icon.cloneNode(true))
  }
  const labelNode = [...button.querySelectorAll('span')]
    .reverse()
    .find((span) => span.children.length === 0 && span.textContent.trim() !== '')
  if (labelNode === undefined) button.append(source.label)
  else labelNode.textContent = source.label

  button.addEventListener('click', (event) => {
    // Без остановки событие дойдёт до React, и он примет его за клик по меню.
    event.preventDefault()
    event.stopPropagation()
    runHeaderAction(source.kind)
  })
  return wrap
}

/**
 * Подмешать Relay и «папку» в открытое меню «⋮».
 * @returns сколько пунктов добавлено (0 — если меню не то или уже размечено).
 */
function addHeaderMenuItems(menu) {
  // Слой существует только на узких экранах. На широком десктопе Relay и
  // «папка» стоят в шапке и никому не мешают — второй раз они там не нужны.
  if (!window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`).matches) return 0
  if (menu.querySelector(`[${MENU_ITEM_ATTR}]`) !== null) return 0
  const template = menu.querySelector('[role="menuitem"]')
  const container = template?.parentElement?.parentElement
  if (template === null || template === undefined || container === undefined || container === null) return 0

  const sources = []
  const relayLink = document.getElementById(RELAY_LINK_ID)
  if (relayLink !== null) {
    sources.push({ kind: 'relay', label: 'Relay', icon: relayLink.querySelector('svg') })
  }
  const explorer = document.querySelector(EXPLORER_SELECTOR)
  if (explorer !== null) {
    sources.push({ kind: 'explorer', label: 'Open in File Explorer', icon: explorer.querySelector('img') })
  }

  let added = 0
  for (const source of sources) {
    const item = buildMenuItem(template, source)
    if (item === null) continue
    container.appendChild(item)
    added += 1
  }
  return added
}

/**
 * Следить за штатным меню «⋮» и добавлять в него переехавшие пункты.
 *
 * Меню — портал React, который создаётся в момент открытия и исчезает при
 * закрытии, поэтому его нельзя разметить один раз: подмешиваем по факту
 * появления. Подмешиваем только после нажатия на сами «три точки» — иначе можно
 * было бы влезть в чужое меню (например, в выбор модели).
 *
 * @returns функция очистки.
 */
function installHeaderActions() {
  let armed = false
  let disarmTimer = null
  let scheduled = false

  const sync = () => {
    scheduled = false
    if (!armed) return
    const menu = findOpenMenu()
    if (menu === null) return
    if (addHeaderMenuItems(menu) > 0) armed = false
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(sync)
  }

  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true })

  const arm = (event) => {
    if (!(event.target instanceof Element)) return
    if (event.target.closest(MORE_ACTIONS_SELECTOR) === null) return
    armed = true
    clearTimeout(disarmTimer)
    disarmTimer = setTimeout(() => { armed = false }, 2000)
    // Меню может уже существовать (клик без pointerdown, повторное открытие) —
    // тогда наблюдатель не сработает и подмешать нужно прямо сейчас.
    schedule()
  }
  // pointerdown ловит палец, click — программные нажатия и клавиатуру.
  document.addEventListener('pointerdown', arm, true)
  document.addEventListener('click', arm, true)

  return () => {
    observer.disconnect()
    document.removeEventListener('pointerdown', arm, true)
    document.removeEventListener('click', arm, true)
    clearTimeout(disarmTimer)
    for (const item of document.querySelectorAll(`[${MENU_ITEM_ATTR}]`)) {
      item.closest('[role="menuitem"]')?.parentElement?.remove()
    }
  }
}
