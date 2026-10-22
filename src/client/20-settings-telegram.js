// 20-settings-telegram.js — карточка «Telegram API» в настройках Mobile UI.
//
// Токен вводится здесь, проверяется хостом через getMe, пишется в config.json
// бота и перезапускает его, чтобы бот переподключился к новому токену.

/** Маршрут настроек Telegram API на веб-сервере harness. */
const TELEGRAM_PATH = '/mobile-ui/telegram'

/** Стили карточки Telegram. */
const TELEGRAM_STYLE = `
.${SECTION_CLASS}-telegram-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}
`

/**
 * Карточка «Telegram API»: токен бота и кнопка сохранения.
 */
function TelegramPanel() {
  const [state, setState] = React.useState(null)
  const [loadError, setLoadError] = React.useState(false)
  const [token, setToken] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)

  React.useEffect(() => {
    let cancelled = false
    fetch(TELEGRAM_PATH, { headers: { accept: 'application/json' } })
      .then((response) => {
        if (!response.ok) {
          if (!cancelled) setLoadError(true)
          return null
        }
        return response.json()
      })
      .then((data) => { if (!cancelled && data !== null) setState(data) })
      .catch(() => { if (!cancelled) setLoadError(true) })
    return () => { cancelled = true }
  }, [])

  const configured = state !== null && state.configured !== false
  const ready = token.trim().length > 0 && !busy

  /** Сохранить токен: проверить, записать и перезапустить бота. */
  const submit = () => {
    setBusy(true)
    setResult(null)
    fetch(TELEGRAM_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    })
      .then((response) => (response.ok ? response.json() : { ok: false, message: `Хост ответил кодом ${String(response.status)}.` }))
      .then((data) => {
        setBusy(false)
        setResult(data)
        if (data.ok === true) {
          setToken('')
          setState({ ok: true, configured: true, hasToken: true, botUsername: data.botUsername ?? '', maskedToken: '' })
        }
      })
      .catch(() => {
        setBusy(false)
        setResult({ ok: false, message: 'Хост не ответил — попробуйте ещё раз.' })
      })
  }

  const children = [
    React.createElement('p', { key: 'title', className: `${SECTION_CLASS}-label` }, 'Telegram API'),
    React.createElement('p', { key: 'hint', className: `${SECTION_CLASS}-lead` },
      'Токен бота из @BotFather. Плагин проверит его, сохранит в config.json и перезапустит бота — тот подключится к новому боту.'),
  ]

  if (state === null) {
    children.push(React.createElement('p', {
      key: 'loading',
      className: `${SECTION_CLASS}-status`,
      'data-tone': loadError ? 'bad' : 'muted',
    }, loadError
      ? 'Не удалось прочитать настройки: перезапустите DSH (dsh web) и обновите страницу.'
      : 'Читаем настройки…'))
    return React.createElement('div', { className: `${SECTION_CLASS}-card` }, children)
  }

  if (state.configured === false) {
    children.push(React.createElement('p', {
      key: 'unconfigured',
      className: `${SECTION_CLASS}-status`,
      'data-tone': 'bad',
    }, state.message ?? 'Путь к config.json бота не задан.'))
    return React.createElement('div', { className: `${SECTION_CLASS}-card` }, children)
  }

  children.push(
    React.createElement('p', {
      key: 'state',
      className: `${SECTION_CLASS}-status`,
      'data-tone': state.hasToken ? 'ok' : 'bad',
    }, state.hasToken
      ? `Сейчас подключён @${state.botUsername || 'бот'} (токен ${state.maskedToken || 'задан'}).`
      : 'Токен ещё не задан.'),
    state.hasToken && state.botUsername
      ? React.createElement('p', { key: 'link', className: `${SECTION_CLASS}-status` }, [
        'Ссылка на бота: ',
        React.createElement('a', {
          key: 'a',
          className: `${SECTION_CLASS}-link`,
          href: `https://t.me/${state.botUsername}`,
          target: '_blank',
          rel: 'noreferrer',
        }, `@${state.botUsername}`),
      ])
      : null,
    React.createElement('div', { key: 'field', className: `${SECTION_CLASS}-field` }, [
      React.createElement('label', {
        key: 'label',
        className: `${SECTION_CLASS}-label`,
        htmlFor: `${SECTION_CLASS}-telegram-token`,
      }, 'Токен бота'),
      React.createElement('input', {
        key: 'input',
        id: `${SECTION_CLASS}-telegram-token`,
        className: `${SECTION_CLASS}-input ${SECTION_CLASS}-telegram-mono`,
        type: 'text',
        autoComplete: 'off',
        spellCheck: false,
        placeholder: '123456789:AA…',
        value: token,
        disabled: busy,
        onChange: (event) => { setToken(event.target.value) },
      }),
    ]),
    React.createElement('div', { key: 'actions', className: `${SECTION_CLASS}-row` }, [
      React.createElement('button', {
        key: 'submit',
        type: 'button',
        className: `${SECTION_CLASS}-button`,
        disabled: !ready || !configured,
        onClick: submit,
      }, busy ? 'Проверяем…' : 'Сохранить и перезапустить'),
      result === null
        ? React.createElement('p', {
          key: 'note',
          className: `${SECTION_CLASS}-status`,
          'data-tone': 'muted',
        }, '')
        : React.createElement('p', {
          key: 'note',
          className: `${SECTION_CLASS}-status`,
          'data-tone': result.ok === true ? 'ok' : 'bad',
        }, result.message),
    ]),
  )

  return React.createElement('div', { className: `${SECTION_CLASS}-card` }, children)
}
