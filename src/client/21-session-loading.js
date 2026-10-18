// 21-session-loading.js — индикатор загрузки при переключении чата.

/**
 * Тонкая полоса вверху экрана, пока грузится выбранный чат.
 *
 * У harness переключение на старую сессию занимает время (история тянется
 * постранично, на телефоне через туннель — секундами), а никакого признака
 * загрузки на телефоне не видно: кажется, что тап не сработал. Полоса
 * появляется в момент тапа по строке сессии и исчезает, как только переписка
 * меняется — по тексту, числу узлов или заголовку чата.
 *
 * Полоса ТОЛЬКО показывает происходящее и ничего не блокирует: раньше рядом с
 * ней жила защита от повторного тапа по списку, и она же была главной причиной
 * «переключиться нельзя» (разбор — в src/client/08-drawer.js).
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

  /** Опрос «пришла ли переписка». null — полосы нет. */
  let poll = null
  /** Когда полосу показывали в последний раз: по нему гасим второй дубль тапа. */
  let shownAt = 0

  const snapshot = () => {
    // Только переписка: заголовок чата обновляется сразу, ещё до того как
    // подъедут сообщения, и по нему полоса гасла бы слишком рано.
    const body = document.querySelector("[class$='_scrollBody']")
    return body === null ? '' : `${body.childElementCount}:${(body.textContent ?? '').length}`
  }

  const hide = () => {
    bar.style.display = 'none'
    if (poll !== null) {
      window.clearInterval(poll)
      poll = null
    }
  }

  /**
   * Показать полосу до смены переписки.
   *
   * Один тап приходит двумя событиями — `pointerup` и `click`. Второе из них не
   * должно начинать отсчёт заново: иначе предел показа ({@link LOADING_MAX_MS})
   * сдвигался бы на каждом событии, и полоса висела бы на один тап дольше, чем
   * нужно.
   */
  const show = (at) => {
    if (at - shownAt < LOADING_DEDUPE_MS) return
    shownAt = at
    hide()
    const before = snapshot()
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
    if (target.closest(SESSION_ROW_SELECTOR) === null) return
    show(Date.now())
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
