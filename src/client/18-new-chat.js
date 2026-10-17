// 18-new-chat.js — кнопка нового чата в шапке телефона.
/**
 * Начать новый чат.
 *
 * Идём через штатную кнопку «New Session» в панели сессий: она скрыта вместе с
 * выдвижной панелью, но обработчик у неё живой — программный `click` доходит до
 * React так же, как настоящий.
 */
function startNewChat() {
  const control = document.querySelector(NEW_SESSION_SELECTOR)
  if (control === null) return
  control.click()
}

/**
 * Поставить в шапку кнопку нового чата — перед «⋮».
 *
 * Кнопка — клон штатной «⋮»: приезжает с родными классами, размером и стилями,
 * поэтому не выделяется среди соседей. Клонирование не переносит обработчики —
 * свой ставим сами.
 *
 * @returns функция очистки.
 */
function installNewChatButton() {
  if (!isNarrow()) return () => {}

  const root = document.documentElement
  let button = null

  const ensure = () => {
    if (button !== null && button.isConnected) {
      root.setAttribute(NEW_CHAT_ATTR, '')
      return button
    }
    const more = document.querySelector(MORE_ACTIONS_SELECTOR)
    if (more === null) {
      // В пустом чате «⋮» нет — кнопку не из чего собрать. Тогда и правую
      // панель не прячем: иначе в шапке справа не осталось бы ничего.
      root.removeAttribute(NEW_CHAT_ATTR)
      button = null
      return null
    }
    // «⋮» завёрнута в обёртку пункта шапки: ставим кнопку перед ней, чтобы
    // отступы и порядок остались родными.
    const wrap = more.closest("[class*='_root_']") ?? more
    const existing = document.querySelector(`.${NEW_CHAT_BUTTON_CLASS}`)
    if (existing !== null && existing.parentElement !== null) {
      button = existing
    } else {
      button = more.cloneNode(true)
      button.className = `${String(more.className)} ${NEW_CHAT_BUTTON_CLASS}`
      button.removeAttribute('aria-haspopup')
      button.removeAttribute('aria-expanded')
      button.removeAttribute('aria-busy')
      button.setAttribute('aria-label', 'New session')
      button.setAttribute('title', 'Новый чат')
      button.addEventListener('click', startNewChat)
      wrap.parentElement.insertBefore(button, wrap)
    }
    // Иконку берём у штатной кнопки «New Session»: тот же плюс в круге, что в
    // панели сессий, только размером под шапку.
    const icon = document.querySelector(`${NEW_SESSION_SELECTOR} svg`)
    if (icon !== null && !button.hasAttribute('data-dsh-mobile-icon')) {
      const copy = icon.cloneNode(true)
      copy.setAttribute('width', '16')
      copy.setAttribute('height', '16')
      button.replaceChildren(copy)
      button.setAttribute('data-dsh-mobile-icon', '')
    }
    root.setAttribute(NEW_CHAT_ATTR, '')
    return button
  }

  ensure()
  // Шапка перерисовывается (React меняет разметку) и уносит кнопку с собой —
  // тогда возвращаем её на место.
  const observer = new MutationObserver(() => {
    if (button === null || !button.isConnected) ensure()
  })
  observer.observe(document.body, { childList: true, subtree: true })

  return () => {
    observer.disconnect()
    if (button !== null && button.isConnected) button.remove()
    button = null
    root.removeAttribute(NEW_CHAT_ATTR)
  }
}
