// 16-settings-pair.js — панель подключения телефона: QR и одноразовый код.
//
// Приглашение живёт в relay и меняется каждые 10 секунд, поэтому панель его
// переспрашивает: когда отсчёт доходит до нуля, хост выдаёт новый код вместе с
// новым QR. Код одноразовый — после подключения он больше не действует.

/** Стили панели подключения. */
const PAIR_STYLE = `
.${SECTION_CLASS}-qr {
  display: flex;
  justify-content: center;
  align-self: center;
  padding: 12px;
  border-radius: 12px;
  /* QR всегда на белом: тёмная тема иначе съедает контраст и камера не читает. */
  background: #fff;
}
.${SECTION_CLASS}-qr svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 208px;
  shape-rendering: crispEdges;
}
.${SECTION_CLASS}-code {
  margin: 0;
  text-align: center;
  font-size: 26px;
  font-weight: 600;
  letter-spacing: 6px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary, #0f1115);
}
.${SECTION_CLASS}-timer {
  margin: 0;
  text-align: center;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.${SECTION_CLASS}-centered {
  display: flex;
  justify-content: center;
}
`

/**
 * Следить за приглашением для телефона.
 *
 * Отсчёт идёт локально, а новый код спрашивается у хоста: relay выдаёт его сам,
 * когда предыдущий истёк.
 *
 * @param active - спрашивать ли приглашение вообще.
 * @returns приглашение, остаток секунд и ручное обновление.
 */
function usePairInvitation(active) {
  const [invitation, setInvitation] = React.useState(null)
  const [secondsLeft, setSecondsLeft] = React.useState(0)

  /** Забрать у хоста текущее приглашение. */
  const refresh = React.useCallback(() => {
    return fetch(PAIR_PATH, { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data === null || data.error !== undefined) return
        setInvitation(data)
        const left = Number(data.expiresInSeconds)
        setSecondsLeft(Number.isFinite(left) ? Math.max(0, Math.round(left)) : 0)
      })
      .catch(() => { /* хост ещё не ответил — повторим по отсчёту */ })
  }, [])

  React.useEffect(() => {
    if (!active) return undefined
    void refresh()
    return undefined
  }, [active, refresh])

  React.useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => { setSecondsLeft((current) => Math.max(0, current - 1)) }, 1000)
    return () => { clearInterval(timer) }
  }, [active])

  React.useEffect(() => {
    if (!active || secondsLeft > 0) return undefined
    // Код истёк: следующий запрос заставит relay выпустить новый.
    const timer = window.setTimeout(() => { void refresh() }, 250)
    return () => { window.clearTimeout(timer) }
  }, [active, secondsLeft, refresh])

  return { invitation, secondsLeft, refresh }
}

/**
 * Панель подключения телефона.
 * @param props - `hasToken` показывает, задан ли токен туннеля.
 */
function PairPanel(props) {
  const { invitation, secondsLeft, refresh } = usePairInvitation(true)
  const [asking, setAsking] = React.useState(false)

  /** Попросить хост выпустить код заново, не дожидаясь истечения. */
  const askNewCode = () => {
    setAsking(true)
    fetch(NEW_CODE_PATH, { method: 'POST', headers: { accept: 'application/json' } })
      .then(() => refresh())
      .catch(() => { /* следующий отсчёт всё равно обновит */ })
      .then(() => { setAsking(false) })
  }

  const children = [
    React.createElement('p', { key: 'title', className: `${SECTION_CLASS}-label` }, 'Подключение телефона'),
  ]

  if (invitation === null) {
    children.push(React.createElement('p', {
      key: 'waiting',
      className: `${SECTION_CLASS}-status`,
      'data-tone': 'muted',
    }, props.hasToken
      ? 'Готовим код подключения…'
      : 'Код появится, когда туннель поднимет ссылку.'))
    return React.createElement('div', { className: `${SECTION_CLASS}-card` }, children)
  }

  children.push(
    React.createElement('div', {
      key: 'qr',
      className: `${SECTION_CLASS}-qr`,
      dangerouslySetInnerHTML: { __html: invitation.qrSvg },
    }),
    React.createElement('p', { key: 'code', className: `${SECTION_CLASS}-code` }, invitation.code),
    React.createElement('p', { key: 'timer', className: `${SECTION_CLASS}-timer` },
      secondsLeft > 0 ? `Код действует ещё ${String(secondsLeft)} с` : 'Обновляем код…'),
    React.createElement('p', { key: 'hint', className: `${SECTION_CLASS}-lead` },
      'Наведите камеру телефона на QR — DeepSeek Harness откроется и подключится сам. Если открываете ссылку вручную, введите код с экрана на странице подключения. Код одноразовый: после подключения он гаснет.'),
    React.createElement('div', { key: 'actions', className: `${SECTION_CLASS}-centered` }, [
      React.createElement('button', {
        key: 'new',
        type: 'button',
        className: `${SECTION_CLASS}-button`,
        disabled: asking,
        onClick: askNewCode,
      }, asking ? 'Обновляем…' : 'Новый код'),
    ]),
  )

  return React.createElement('div', { className: `${SECTION_CLASS}-card` }, children)
}
