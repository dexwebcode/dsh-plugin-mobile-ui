// 19-settings-scroll.js — лента разделов настроек: активный пункт виден.
/**
 * Довести активный раздел настроек в видимую часть ленты.
 *
 * На телефоне разделы едут горизонтальной строкой (см. 05-styles/19-settings-screen.js),
 * и раздел, выбранный не первым, мог оказаться за краем. Ленту двигаем её же
 * `scrollLeft`, а не `scrollIntoView`: тот умеет утащить за собой всю страницу.
 */
function installSettingsScroll() {
  if (!isNarrow()) return () => {}

  let scheduled = false
  const sync = () => {
    scheduled = false
    const dialog = document.querySelector(SETTINGS_DIALOG_SELECTOR)
    if (dialog === null) return
    const list = dialog.querySelector(`[class$='_navList']`)
    // У активного пункта к классу добавляется `_active`, поэтому имя класса
    // проверяем вхождением, а не окончанием.
    const active = dialog.querySelector(`[class*='_navCell'][aria-current]`) ??
      dialog.querySelector(`[class*='_navCell'][class*='_active']`)
    if (list === null || active === null) return
    const listRect = list.getBoundingClientRect()
    const cellRect = active.getBoundingClientRect()
    if (cellRect.left < listRect.left) {
      list.scrollLeft += cellRect.left - listRect.left - 8
    } else if (cellRect.right > listRect.right) {
      list.scrollLeft += cellRect.right - listRect.right + 8
    }
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(sync)
  }

  // Диалог — портал: он появляется и исчезает целиком, а активный раздел
  // меняется кликом. Наблюдаем за документом, как и остальные части слоя.
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-current', 'class'] })
  schedule()

  return () => {
    observer.disconnect()
  }
}
