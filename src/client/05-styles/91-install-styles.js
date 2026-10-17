// 05-styles/91-install-styles.js — добавить блоки стилей в документ.
/** Добавить блоки стилей, если их ещё нет. */
function installStyles() {
  for (let index = 0; index < STYLES.length; index++) {
    if (document.querySelector(`style[${MARKER}="${index}"]`) !== null) continue
    const tag = document.createElement('style')
    tag.setAttribute(MARKER, String(index))
    tag.textContent = STYLES[index]
    document.head.appendChild(tag)
  }
}
