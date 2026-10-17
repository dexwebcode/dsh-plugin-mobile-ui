// 05-styles/92-remove-styles.js — убрать все блоки стилей из документа.
/** Убрать блоки стилей. */
function removeStyles() {
  for (const tag of document.querySelectorAll(`style[${MARKER}]`)) tag.remove()
}
