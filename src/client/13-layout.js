// 13-layout.js — установка и снятие частей слоя по ширине экрана.
function trackLayout() {
  const narrow = window.matchMedia(`(max-width: ${NARROW_MAX_PX}px)`)
  let teardown = []

  const release = () => {
    for (const dispose of teardown.reverse()) dispose()
    teardown = []
  }

  const install = () => {
    if (!isNarrow()) {
      // Широкий экран: снимаем всё, что навязывало телефонное поведение.
      release()
      return
    }
    if (teardown.length > 0) return
    teardown = [
      installPanelState(),
      installHeaderStatus(),
      installStatsDock(),
      installDrawer(),
      installNewChatButton(),
      installSettingsScroll(),
      installSessionLoading(),
      installScrollButton(),
    ]
  }

  install()
  // `addEventListener` у MediaQueryList есть в том же Chrome и Safari, что и
  // сам слой; проверка на месте нужна, чтобы старый браузер не уронил установку
  // всего слоя.
  if (typeof narrow.addEventListener === 'function') narrow.addEventListener('change', install)

  return () => {
    if (typeof narrow.removeEventListener === 'function') narrow.removeEventListener('change', install)
    release()
  }
}
