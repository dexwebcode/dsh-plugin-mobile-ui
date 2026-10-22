// 26-modes.js — режимы интерфейса: «Экономный» и «Обычный».
//
// Экономный режим оставляет на экране только переписку: сообщения человека и
// ответы DeepSeek. Он убирает вкладку «Trajectory», блоки шагов и вызовов
// инструментов, живую строку этапа, плашку этапа в шапке и полосу статистики.
//
// Вкладку траектории убираем из разметки, а не прячем за прозрачностью: клиент
// запрашивает данные региона, когда её открывают, поэтому скрытая вкладка — это
// ещё и не запрошенная траектория (на мобильном интернете это самая тяжёлая
// часть ответа).
//
// Режим хранится в localStorage: переключатель с телефона не должен зависеть от
// host-половины, а выбор — переживать перезапуск harness. Переключают его двумя
// способами: полоской в самом верху экрана и строкой в настройках Mobile UI.

/** Режимы в порядке показа на полоске. */
const MODE_LIST = [
  {
    id: 'economy',
    label: 'Экономный',
    hint: 'Только чат: без траектории, шагов, статистики и лишних плашек',
  },
  {
    id: 'normal',
    label: 'Обычный',
    hint: 'Всё как обычно: траектория, шаги, статистика',
  },
]

/** Ключ режима в localStorage браузера. */
const MODE_STORAGE_KEY = 'dsh-mobile-ui-mode'

/** Атрибут на корне документа: по нему включаются правила экономного режима. */
const MODE_ATTR = 'data-dsh-mobile-mode'

/** Событие смены режима: по нему пересчитывается слой статистики и настройки. */
const MODE_CHANGE_EVENT = 'dsh-mobile-mode'

/** id тега стилей слоя: повторная установка не должна плодить копии. */
const MODE_STYLE_ID = 'dsh-mobile-ui-modes'

/** Селекторы, которые экономный режим убирает с экрана. */
const ECONOMY_HIDDEN_SELECTORS = [
  // Плашка «что происходит» в шапке — между логотипом и кнопкой нового чата.
  '.dsh-mobile-status',
  // Лента разделов беседы: единственная оставшаяся вкладка «Chat» никому не нужна.
  '[data-conversation-tabs]',
  // Свёрнутый блок «сколько шёл ход» целиком.
  '[data-chat-flow-kind="turn-process"]',
  // Группы шагов: «Analysis completed», «Ran commands» и их содержимое.
  '[data-step-process]',
  // Рассуждения шага.
  '[data-chat-flow-kind="assistant-step"][data-chat-group-part="reasoning"]',
  // Итог хода: сводка правок («Edited 6 files +1,283 -10»).
  '[data-chat-flow-kind="turn-tail"]',
  // Плашка задач над полем ввода: это отчёт инструмента, а не переписка.
  '[data-testid="todo-panel"]',
  // Живая строка этапа под перепиской («Deep diving for 6m 38s …»).
  '[data-chat-running]',
  // Своя полоса статистики слоя.
  '.dsh-mobile-stats-bar',
]

/**
 * Прочитать сохранённый режим.
 * @returns `'economy'`, `'normal'` или null, если выбора ещё не было.
 */
function readStoredMode() {
  try {
    const value = window.localStorage.getItem(MODE_STORAGE_KEY)
    return value === 'economy' || value === 'normal' ? value : null
  } catch {
    return null
  }
}

/**
 * Текущий режим.
 * @returns `'economy'` или `'normal'`.
 */
function currentMode() {
  return document.documentElement.getAttribute(MODE_ATTR) === 'economy' ? 'economy' : 'normal'
}

/**
 * Включён ли экономный режим.
 * @returns признак режима.
 */
function isEconomyMode() {
  return currentMode() === 'economy'
}

/**
 * Включить режим и сообщить об этом всем, кто его показывает.
 *
 * Полоски в шапке нет намеренно: она сдвигала верхнюю панель, а та должна стоять
 * ровно там же, где стояла. Переключатель живёт в настройках Mobile UI.
 *
 * @param mode - `'economy'` или `'normal'`.
 */
function applyMode(mode) {
  const next = mode === 'economy' ? 'economy' : 'normal'
  const root = document.documentElement
  if (root.getAttribute(MODE_ATTR) !== next) root.setAttribute(MODE_ATTR, next)
  try {
    window.localStorage.setItem(MODE_STORAGE_KEY, next)
  } catch {
    // Приватный режим браузера — режим просто не запомнится.
  }
  window.dispatchEvent(new CustomEvent(MODE_CHANGE_EVENT, { detail: { mode: next } }))
}

/** Вставить стили экономного режима и блока настроек (один раз на страницу). */
function installModeStyles() {
  if (document.getElementById(MODE_STYLE_ID) !== null) return
  const hidden = ECONOMY_HIDDEN_SELECTORS
    .map((selector) => `html[${MODE_ATTR}='economy'] ${selector}`)
    .join(',\n')
  const tag = document.createElement('style')
  tag.id = MODE_STYLE_ID
  tag.textContent = `
${hidden} {
  display: none !important;
}
/* Место под полосу статистики резервируется правилом слоя с !important, поэтому
   в экономном режиме его надо снимать таким же по весу правилом, а не инлайном. */
html[${MODE_ATTR}='economy'] [class$='_frame'] {
  padding-top: 0 !important;
}
/* Вкладок в экономном режиме нет, но шапка держит их высоту: строка названия
   растягивается до 65px, кнопки справа уезжают вниз, а логотип (он абсолютный,
   top: 8px) остаётся сверху — панель выглядит кривой, а нижняя граница висит
   на 76px. Сжимаем шапку в одну строку и центрируем в ней логотип и кнопки. */
html[${MODE_ATTR}='economy'] header[class*='_header'] {
  min-height: 0 !important;
  grid-template-rows: auto !important;
  padding-top: 6px !important;
  padding-bottom: 6px !important;
  align-items: center !important;
}
html[${MODE_ATTR}='economy'] header[class*='_header'] .dsh-mobile-drawer-button {
  /* Центр строки минус половина высоты кита (34 / 2 = 17) плюс 3px: на столько
     кнопки справа стоят выше центра строки — так кит встаёт с ними в одну линию. */
  top: 50% !important;
  margin-top: -20px !important;
}
.dsh-mobile-modes {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dsh-mobile-modes-chips {
  display: flex;
  gap: 6px;
}
.dsh-mobile-modes-chip {
  flex: 1 1 0;
  min-height: 38px;
  padding: 0 12px;
  border: 1px solid rgba(128, 128, 128, 0.24);
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.dsh-mobile-modes-chip[data-active='true'] {
  border-color: transparent;
  background: #4d6bfe;
  color: #fff;
}
.dsh-mobile-modes-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  opacity: 0.68;
}
.dsh-mobile-modes-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.5;
  opacity: 0.68;
}
`
  document.head.appendChild(tag)
}

/**
 * Включить режимы.
 *
 * Полоски в шапке нет: она сдвигала верхнюю панель вниз, а та должна стоять ровно
 * там же, где стояла. Единственный переключатель — строка «Режим» в настройках
 * Mobile UI. Здесь остаётся применить сохранённый выбор и вставить стили.
 *
 * @returns функция очистки.
 */
function installModes() {
  installModeStyles()
  // Режим применяем сразу: иначе первый кадр покажет «Обычный» и перерисуется.
  applyMode(readStoredMode() ?? 'normal')
  return () => {
    // Ничего не держим: обработчики живут в настройках и в слое статистики.
  }
}

/**
 * Строка «Режим» в настройках Mobile UI.
 *
 * Единственное место, где режим переключается: полоску в шапке убрали, потому что
 * она сдвигала верхнюю панель. Здесь же видно, что именно режим выключает.
 *
 * @returns элемент раздела настроек.
 */
function ModePanel() {
  const [mode, setMode] = React.useState(() => currentMode())

  React.useEffect(() => {
    const sync = () => { setMode(currentMode()) }
    window.addEventListener(MODE_CHANGE_EVENT, sync)
    return () => { window.removeEventListener(MODE_CHANGE_EVENT, sync) }
  }, [])

  const choose = (next) => {
    applyMode(next)
    setMode(next)
  }

  return React.createElement('div', { className: 'dsh-mobile-modes' }, [
    React.createElement('p', { key: 'title', className: 'dsh-mobile-modes-hint' }, 'Режим'),
    React.createElement('div', { key: 'chips', className: 'dsh-mobile-modes-chips' },
      MODE_LIST.map((item) => React.createElement('button', {
        key: item.id,
        type: 'button',
        className: 'dsh-mobile-modes-chip',
        'data-active': mode === item.id ? 'true' : 'false',
        title: item.hint,
        onClick: () => { choose(item.id) },
      }, item.label))),
    mode === 'economy'
      ? React.createElement('ul', { key: 'list', className: 'dsh-mobile-modes-list' }, [
        React.createElement('li', { key: 'tabs' }, 'вкладка «Trajectory» не показывается и не запрашивается'),
        React.createElement('li', { key: 'steps' }, 'блоки шагов и вызовов инструментов скрыты'),
        React.createElement('li', { key: 'status' }, 'плашка этапа в шапке и полоса статистики убраны'),
        React.createElement('li', { key: 'left' }, 'остаются только переписка и ответы DeepSeek'),
      ])
      : React.createElement('p', { key: 'hint', className: 'dsh-mobile-modes-hint' },
        'Всё как обычно: видно траекторию, шаги инструментов, полосу статистики и плашку этапа.'),
    React.createElement('p', { key: 'note', className: 'dsh-mobile-modes-hint' },
      'Режим запоминается в этом браузере и не зависит от остальных настроек.'),
  ])
}
