// 21-session-loading.js — индикатор загрузки при переключении чата.

/**
 * Идёт переключение чата: полоса показана, переписка ещё не сменилась.
 *
 * Этим вопросом пользуется слой панели ({@link installDrawer}): повторный тап по
 * списку сессий, пока предыдущая ещё грузится, harness не переживает — открытие
 * теряет ссылку (`Session reference "…" is released`), и экран навсегда остаётся
 * на «Loading history…». На телефоне, где история едет десятки секунд, это и
 * выглядит как «сессии не грузятся».
 *
 * Признак ставится тапом и снимается, когда переписка сменилась: подсказку
 * самого harness («Loading history…») брать нельзя — у работающей сессии она
 * висит постоянно, и защита перекрыла бы переключение совсем.
 */
let sessionSwitchInFlight = false

/** Идёт переключение чата? */
function isSessionSwitchInFlight() {
  return sessionSwitchInFlight
}

/**
 * Идёт восстановление истории: harness показывает «Loading history…», а
 * переписки ещё нет.
 *
 * Именно в этом состоянии тап по другой сессии обрывает открытие. У работающей
 * сессии та же подсказка висит рядом с сообщениями — по одному тексту подсказки
 * их не различить, поэтому вторая половина условия: переписка пуста (в ней
 * только сама подсказка).
 */
function isRestoringHistory() {
  const body = document.querySelector("[class$='_scrollBody']")
  if (body === null) return false
  if (document.querySelector("[data-chat-flow] > [class$='_hint']") === null) return false
  return (body.textContent ?? '').length < RESTORE_ONLY_TEXT_MAX
}

/** Сессия занята: переключение по тапу или восстановление истории. */
function isSessionBusy() {
  return sessionSwitchInFlight || isRestoringHistory()
}

/**
 * Тонкая полоса вверху экрана, пока грузится выбранный чат.
 *
 * У harness переключение на старую сессию занимает время (история тянется
 * постранично), а никакого признака загрузки на телефоне не видно: кажется, что
 * тап не сработал. Полоса появляется в момент тапа по строке сессии и исчезает,
 * как только переписка меняется — по тексту, числу узлов или заголовку чата.
 */
function installSessionLoading() {
  if (!isNarrow()) return () => {}

  const bar = document.createElement('div')
  bar.className = LOADING_CLASS
  bar.setAttribute('aria-hidden', 'true')
  bar.style.display = 'none'
  const capsule = document.createElement('span')
  bar.appendChild(capsule)
  document.body.appendChild(bar)

  let poll = null

  const snapshot = () => {
    // Только переписка: заголовок чата обновляется сразу, ещё до того как
    // подъедут сообщения, и по нему полоса гасла бы слишком рано.
    const body = document.querySelector("[class$='_scrollBody']")
    return body === null ? '' : `${body.childElementCount}:${(body.textContent ?? '').length}`
  }

  const hide = () => {
    sessionSwitchInFlight = false
    bar.style.display = 'none'
    if (poll !== null) {
      window.clearInterval(poll)
      poll = null
    }
  }

  const show = () => {
    hide()
    const before = snapshot()
    sessionSwitchInFlight = true
    bar.style.display = 'block'
    let elapsed = 0
    poll = window.setInterval(() => {
      elapsed += LOADING_POLL_MS
      // Ждём именно загрузку переписки: полоса гаснет, когда она появилась.
      // Если чат так и не приехал (обрыв, зависший туннель), полоса держится до
      // предела и гаснет — но не раньше: пустой экран без индикатора хуже.
      if (snapshot() !== before || elapsed >= LOADING_MAX_MS) hide()
    }, LOADING_POLL_MS)
  }

  /** Тап по строке сессии: и по `pointerup`, и по `click` — что придёт раньше. */
  const onTap = (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest("[class$='_sessionRow']") === null) return
    show()
  }

  document.addEventListener('pointerup', onTap, true)
  document.addEventListener('click', onTap, true)

  return () => {
    document.removeEventListener('pointerup', onTap, true)
    document.removeEventListener('click', onTap, true)
    hide()
    bar.remove()
  }
}
