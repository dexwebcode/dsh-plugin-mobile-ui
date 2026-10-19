// 23-vpn-hint.js — «работает только с VPN», если интерфейс не получил данные.
//
// DeepSeek API блокируется из РФ: harness не получает данные, и интерфейс
// остаётся пустым без всякого объяснения. Плашка появляется, если за
// VPN_HINT_DELAY_MS поле ввода так и не появилось или если сетевой запрос к
// хосту упал раньше, и исчезает сама, как только интерфейс догрузился.

const VPN_HINT_CLASS = 'dsh-mobile-vpn-hint'
const VPN_HINT_STYLE_ATTR = 'data-dsh-mobile-vpn-hint'
/** Текст подсказки: DeepSeek API блокируется из РФ, и данные не приходят. */
const VPN_HINT_TEXT = 'Плагин Mobile UI для DeepSeek Harness работает только с VPN, если вы из РФ. Разработчик уже решает эту проблему.'
/** Сколько ждём появления поля ввода, прежде чем заподозрить блокировку сети. */
const VPN_HINT_DELAY_MS = 12000
const VPN_HINT_POLL_MS = 500
const VPN_HINT_STYLE = `
.${VPN_HINT_CLASS} {
  position: fixed;
  left: 12px;
  right: 12px;
  top: calc(env(safe-area-inset-top, 0px) + 12px);
  z-index: 400;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fff4d6;
  color: #4a3703;
  font-size: 13px;
  line-height: 1.45;
  box-shadow: 0 8px 28px rgb(0 0 0 / 20%);
}
@media (prefers-color-scheme: dark) {
  .${VPN_HINT_CLASS} {
    background: #3a2f10;
    color: #f6e3a8;
  }
}
`

/**
 * Подсказка про VPN на время загрузки.
 * @returns функция снятия: убирает плашку и возвращает исходный `fetch`.
 */
function installVpnHint() {
  if (document.querySelector(`style[${VPN_HINT_STYLE_ATTR}]`) === null) {
    const style = document.createElement('style')
    style.setAttribute(VPN_HINT_STYLE_ATTR, '')
    style.textContent = VPN_HINT_STYLE
    document.head.appendChild(style)
  }

  const notice = document.createElement('div')
  notice.className = VPN_HINT_CLASS
  notice.setAttribute('role', 'status')
  notice.style.display = 'none'
  notice.textContent = VPN_HINT_TEXT
  document.body.appendChild(notice)

  /** Интерфейс догрузился: поле ввода на месте. */
  const loaded = () => document.querySelector(COMPOSER_SEAT_SELECTOR) !== null

  let shown = false
  const show = () => {
    if (shown || loaded()) return
    shown = true
    notice.style.display = 'block'
  }
  const hide = () => {
    if (!shown) return
    shown = false
    notice.style.display = 'none'
  }

  const startedAt = Date.now()
  const poll = window.setInterval(() => {
    if (loaded()) {
      hide()
      window.clearInterval(poll)
      return
    }
    if (Date.now() - startedAt >= VPN_HINT_DELAY_MS) show()
  }, VPN_HINT_POLL_MS)

  // Сетевой отказ при загрузке — более ранний признак, чем таймаут.
  const nativeFetch = window.fetch
  const patchedFetch = typeof nativeFetch === 'function'
    ? function () {
        return nativeFetch.apply(this, arguments).catch((error) => {
          show()
          throw error
        })
      }
    : null
  if (patchedFetch !== null) window.fetch = patchedFetch

  return () => {
    window.clearInterval(poll)
    if (patchedFetch !== null && window.fetch === patchedFetch) window.fetch = nativeFetch
    hide()
    notice.remove()
  }
}
