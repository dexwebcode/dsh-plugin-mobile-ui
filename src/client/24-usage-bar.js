// 24-usage-bar.js — полоса расхода трафика ngrok в шапке панели.
//
// У бесплатного ngrok 1 ГБ исходящего трафика в месяц; когда он кончается,
// страница на телефоне просто перестаёт открываться (ERR_NGROK_725). Чтобы это
// не было сюрпризом, под логотипом показывается полоса остатка: она начинает
// полной и зелёной, по мере расхода укорачивается и меняет цвет на оранжевый,
// затем на красный.
//
// Числа берутся у host-половины (`src/host/usage.js`): relay считает отданные
// байты, плагин складывает их по аккаунтам и месяцам.

const USAGE_CLASS = 'dsh-mobile-usage'
const USAGE_STYLE_ATTR = 'data-dsh-mobile-usage'
const USAGE_PATH = '/mobile-ui/usage'
/** Как часто обновлять число. Счётчик на хосте снимается раз в 30 с. */
const USAGE_POLL_MS = 60000
/** Зелёный, пока осталось больше половины; оранжевый — до пятой части. */
const USAGE_WARN_RATIO = 0.5
const USAGE_BAD_RATIO = 0.2
const USAGE_STYLE = `
.${USAGE_CLASS} {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 6px 10px 10px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--dsw-alias-label-secondary, #61666b);
  user-select: none;
}
.${USAGE_CLASS}-track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: rgb(128 128 128 / 22%);
  overflow: hidden;
}
.${USAGE_CLASS}-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: #22c55e;
  transition: width 400ms ease, background-color 400ms ease;
}
.${USAGE_CLASS}-fill[data-level='warn'] { background: #f59e0b; }
.${USAGE_CLASS}-fill[data-level='bad'] { background: #ef4444; }
.${USAGE_CLASS}-label {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-variant-numeric: tabular-nums;
}
.${USAGE_CLASS}-caption {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
`

/**
 * Байты в человеческий вид.
 * @param bytes - число байт.
 * @returns строка вида «412 МБ».
 */
function formatBytes(bytes) {
  const value = Number(bytes) || 0
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} ГБ`
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} МБ`
  if (value >= 1024) return `${Math.round(value / 1024)} КБ`
  return `${Math.round(value)} Б`
}

/**
 * Уровень тревоги по остатку.
 * @param remainingRatio - доля остатка от лимита.
 * @returns имя уровня для атрибута стиля.
 */
function levelFor(remainingRatio) {
  if (remainingRatio <= USAGE_BAD_RATIO) return 'bad'
  if (remainingRatio <= USAGE_WARN_RATIO) return 'warn'
  return 'ok'
}

/**
 * Нарисовать полосу расхода в шапке панели.
 *
 * Элемент живёт вне React-дерева harness, поэтому вставку сторожит интервал:
 * перерисовка панели пересоздаёт строку с логотипом и уносит нашу полосу.
 *
 * @returns функция снятия слоя.
 */
function installUsageBar() {
  if (document.querySelector(`style[${USAGE_STYLE_ATTR}]`) === null) {
    const style = document.createElement('style')
    style.setAttribute(USAGE_STYLE_ATTR, '')
    style.textContent = USAGE_STYLE
    document.head.appendChild(style)
  }

  const bar = document.createElement('div')
  bar.className = USAGE_CLASS
  bar.setAttribute('role', 'status')
  bar.setAttribute('aria-label', 'Расход трафика ngrok')

  const track = document.createElement('div')
  track.className = `${USAGE_CLASS}-track`
  const fill = document.createElement('div')
  fill.className = `${USAGE_CLASS}-fill`
  track.appendChild(fill)

  const label = document.createElement('div')
  label.className = `${USAGE_CLASS}-label`
  const caption = document.createElement('span')
  caption.className = `${USAGE_CLASS}-caption`
  const rest = document.createElement('span')
  label.appendChild(caption)
  label.appendChild(rest)

  bar.appendChild(track)
  bar.appendChild(label)

  /** Поставить полосу сразу под строку с логотипом. */
  const ensure = () => {
    const sidebar = document.querySelector("[class$='_sidebarCol']")
    if (sidebar === null) {
      if (bar.isConnected) bar.remove()
      return
    }
    const logoRow = sidebar.querySelector("[class*='_logoRow']")
    if (logoRow === null) {
      if (!bar.isConnected) sidebar.prepend(bar)
      return
    }
    if (logoRow.nextElementSibling !== bar) logoRow.after(bar)
  }

  /** Перерисовать числа. */
  const render = (data) => {
    if (data === null || typeof data !== 'object' || !Number.isFinite(data.limit) || data.limit <= 0) return
    bar.style.display = ''
    const usedRatio = Math.min(1, Math.max(0, Number(data.ratio) || 0))
    const remainingRatio = 1 - usedRatio
    fill.style.width = `${Math.round(remainingRatio * 100)}%`
    fill.setAttribute('data-level', levelFor(remainingRatio))
    caption.textContent = `ngrok ${formatBytes(data.used)} / ${formatBytes(data.limit)}`
    rest.textContent = `${Math.round(remainingRatio * 100)}%`
    const accountLabel = typeof data.name === 'string' && data.name !== ''
      ? `${data.name} (аккаунт ${String(data.account)} из ${String(data.accounts)})`
      : `Аккаунт ${String(data.account)} из ${String(data.accounts)}`
    bar.title = `${accountLabel}. Квота обновится первого числа.`
  }

  const poll = () => {
    fetch(USAGE_PATH, { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { render(data) })
      .catch(() => { /* хост не ответил — оставляем прежние числа */ })
  }

  ensure()
  poll()
  const layout = window.setInterval(ensure, 1000)
  const timer = window.setInterval(poll, USAGE_POLL_MS)

  return () => {
    window.clearInterval(layout)
    window.clearInterval(timer)
    bar.remove()
  }
}
