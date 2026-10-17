// 20-server-access.js — раздел «Сервер» в настройках: ссылка, QR, пароль, перезапуск.
// React уже объявлен в 15-settings.js: фрагменты делят один скоуп.

/** Id раздела в реестре слотов настроек. */
const SERVER_SECTION_ID = 'server-access'

/** Класс корня раздела; он же префикс его элементов. */
const SERVER_CLASS = 'dsh-server-access'

/** Атрибут-маркер своего блока стилей. */
const SERVER_STYLE_ATTR = 'data-dsh-mobile-ui-server'

/** Маршрут приглашения для телефона: QR и одноразовый код (отдаёт relay). */
const SERVER_PAIR_PATH = '/relay/pair.json'

/** Маршрут смены пароля (отдаёт relay; телефон после входа для него оператор). */
const SERVER_PASSWORD_PATH = '/relay/password'

/** Маршрут перезапуска сервера: его добавляет host-половина плагина. */
const SERVER_RESTART_PATH = '/mobile-ui/restart'

/** Минимальная длина пароля — то же правило, что и у relay. */
const SERVER_PASSWORD_MIN = 10

/** Стили раздела: карточки в тех же токенах темы, что и остальные настройки. */
const SERVER_STYLE = `
.${SERVER_CLASS}-lead {
  margin: 0;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.${SERVER_CLASS}-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, rgb(0 0 0 / 3%));
}
.${SERVER_CLASS}-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.${SERVER_CLASS}-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.${SERVER_CLASS}-link {
  flex: 1 1 200px;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
  color: inherit;
  font: inherit;
  overflow-wrap: anywhere;
}
.${SERVER_CLASS}-button {
  height: 34px;
  padding: 0 16px;
  border: none;
  border-radius: 8px;
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  color: #fff;
  font: inherit;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.${SERVER_CLASS}-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.${SERVER_CLASS}-secondary {
  background: var(--dsw-alias-bg-module-platform, rgb(0 0 0 / 6%));
  color: var(--dsw-alias-label-primary, #0f1115);
}
.${SERVER_CLASS}-input {
  flex: 1 1 200px;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
  color: inherit;
  font: inherit;
}
.${SERVER_CLASS}-qr {
  display: flex;
  justify-content: center;
}
.${SERVER_CLASS}-qr-box {
  width: 200px;
  height: 200px;
  padding: 8px;
  border-radius: 12px;
  background: #fff;
  box-sizing: border-box;
}
.${SERVER_CLASS}-qr-box svg {
  display: block;
  width: 100%;
  height: 100%;
}
.${SERVER_CLASS}-code {
  margin: 0;
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 0.12em;
  font-variant-numeric: tabular-nums;
}
.${SERVER_CLASS}-status {
  margin: 0;
  font-size: 13px;
}
.${SERVER_CLASS}-status[data-tone='ok'] { color: var(--dsw-alias-state-success-primary, #22c55e); }
.${SERVER_CLASS}-status[data-tone='bad'] { color: var(--dsw-alias-state-error-primary, #ef4444); }
.${SERVER_CLASS}-status[data-tone='muted'] { color: var(--dsw-alias-label-secondary, #61666b); }
`

/** Поставить блок стилей раздела, если его ещё нет. */
function installServerAccessStyles() {
  if (document.querySelector(`style[${SERVER_STYLE_ATTR}]`) !== null) return
  const tag = document.createElement('style')
  tag.setAttribute(SERVER_STYLE_ATTR, '')
  tag.textContent = SERVER_STYLE
  document.head.appendChild(tag)
}

/** Ссылка, по которой телефон открывает этот же интерфейс. */
function serverLink() {
  return window.location.origin
}

/**
 * Код подключения и QR из relay.
 *
 * Приглашение выдаёт сам relay: он же рисует QR, в который зашиты ссылка,
 * одноразовый код и отпечаток сертификата. Отдельный генератор QR не нужен.
 *
 * @returns состояние приглашения и функция его перезапроса.
 */
function usePairInvitation() {
  const [invitation, setInvitation] = React.useState(null)
  const [error, setError] = React.useState('')
  const [left, setLeft] = React.useState(0)

  const load = React.useCallback(() => {
    setError('')
    fetch(SERVER_PAIR_PATH, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data) => {
        setInvitation(data)
        setLeft(Math.max(0, Math.round(data.expiresInSeconds ?? 0)))
      })
      .catch(() => {
        setInvitation(null)
        setError('Код подключения недоступен. Откройте интерфейс через публичную ссылку и войдите по паролю.')
      })
  }, [])

  React.useEffect(() => { load() }, [load])

  React.useEffect(() => {
    if (invitation === null) return undefined
    const timer = window.setInterval(() => {
      setLeft((value) => {
        if (value <= 1) {
          window.clearInterval(timer)
          load()
          return 0
        }
        return value - 1
      })
    }, 1000)
    return () => { window.clearInterval(timer) }
  }, [invitation, load])

  return { invitation, error, left, reload: load }
}

/**
 * Раздел «Сервер»: ссылка, QR для телефона, смена пароля и перезапуск.
 */
function ServerAccessSection() {
  const { invitation, error, left, reload } = usePairInvitation()
  const [copied, setCopied] = React.useState(false)
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [note, setNote] = React.useState(null)
  const [restarting, setRestarting] = React.useState(false)
  const link = serverLink()

  /** Положить ссылку в буфер обмена; без буфера — выделить её. */
  const copy = () => {
    const done = () => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    }
    if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(link).then(done, () => {
        const field = document.querySelector(`.${SERVER_CLASS}-link`)
        if (field !== null && typeof field.select === 'function') field.select()
      })
      return
    }
    const field = document.querySelector(`.${SERVER_CLASS}-link`)
    if (field !== null && typeof field.select === 'function') field.select()
  }

  /** Сменить пароль на вход. */
  const savePassword = () => {
    if (password.length < SERVER_PASSWORD_MIN) {
      setNote({ tone: 'bad', text: `Пароль должен быть не короче ${SERVER_PASSWORD_MIN} символов.` })
      return
    }
    if (password !== confirm) {
      setNote({ tone: 'bad', text: 'Пароли не совпадают.' })
      return
    }
    setSaving(true)
    setNote(null)
    fetch(SERVER_PASSWORD_PATH, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ password, confirm, next: '/' }).toString(),
    })
      .then((response) => {
        if (response.ok) {
          setPassword('')
          setConfirm('')
          setNote({ tone: 'ok', text: 'Пароль сохранён.' })
          return
        }
        setNote({ tone: 'bad', text: `Не удалось сохранить пароль (${response.status}).` })
      })
      .catch(() => { setNote({ tone: 'bad', text: 'Сервер не ответил.' }) })
      .finally(() => { setSaving(false) })
  }

  /** Перезапустить сервер, если host-половина это умеет. */
  const restart = () => {
    setRestarting(true)
    setNote(null)
    fetch(SERVER_RESTART_PATH, { method: 'POST', headers: { accept: 'application/json' } })
      .then((response) => {
        if (response.ok) {
          setNote({ tone: 'ok', text: 'Сервер перезапускается — страница переподключится сама…' })
          window.setTimeout(() => { window.location.reload() }, 2500)
          return
        }
        setNote({
          tone: 'muted',
          text: 'Перезапуск сервера с телефона недоступен: в этой сборке нет host-маршрута перезапуска. Перезагрузите интерфейс соседней кнопкой или перезапустите dsh web на компьютере.',
        })
      })
      .catch(() => { setNote({ tone: 'bad', text: 'Сервер не ответил.' }) })
      .finally(() => { setRestarting(false) })
  }

  return React.createElement('div', { className: SERVER_CLASS }, [
    React.createElement('p', { key: 'lead', className: `${SERVER_CLASS}-lead` },
      'Публичный адрес, подключение телефона, пароль и перезапуск — в одном месте.'),

    React.createElement('div', { key: 'link-card', className: `${SERVER_CLASS}-card` }, [
      React.createElement('h3', { key: 'title', className: `${SERVER_CLASS}-title` }, 'Ссылка на сервер'),
      React.createElement('div', { key: 'row', className: `${SERVER_CLASS}-row` }, [
        React.createElement('input', {
          key: 'link',
          className: `${SERVER_CLASS}-link`,
          readOnly: true,
          value: link,
          onFocus: (event) => { event.target.select() },
        }),
        React.createElement('button', {
          key: 'copy',
          type: 'button',
          className: `${SERVER_CLASS}-button`,
          onClick: copy,
        }, copied ? 'Скопировано' : 'Копировать'),
      ]),
    ]),

    React.createElement('div', { key: 'qr-card', className: `${SERVER_CLASS}-card` }, [
      React.createElement('h3', { key: 'title', className: `${SERVER_CLASS}-title` }, 'Подключение телефона'),
      error !== ''
        ? React.createElement('p', { key: 'error', className: `${SERVER_CLASS}-status`, 'data-tone': 'muted' }, error)
        : React.createElement('div', { key: 'qr', className: `${SERVER_CLASS}-qr` },
            React.createElement('div', {
              className: `${SERVER_CLASS}-qr-box`,
              // QR рисует relay: в него зашиты ссылка, код и отпечаток сертификата.
              dangerouslySetInnerHTML: { __html: invitation === null ? '' : String(invitation.qrSvg ?? '') },
            })),
      invitation !== null
        ? React.createElement('p', { key: 'code', className: `${SERVER_CLASS}-code` }, String(invitation.code ?? ''))
        : null,
      invitation !== null
        ? React.createElement('p', { key: 'timer', className: `${SERVER_CLASS}-status`, 'data-tone': 'muted' },
            `Код одноразовый: ещё ${left} с, затем он обновится сам.`)
        : null,
      React.createElement('div', { key: 'row', className: `${SERVER_CLASS}-row` }, [
        React.createElement('button', {
          key: 'reload',
          type: 'button',
          className: `${SERVER_CLASS}-button ${SERVER_CLASS}-secondary`,
          onClick: reload,
        }, 'Новый код'),
      ]),
    ]),

    React.createElement('div', { key: 'password-card', className: `${SERVER_CLASS}-card` }, [
      React.createElement('h3', { key: 'title', className: `${SERVER_CLASS}-title` }, 'Пароль для входа'),
      React.createElement('label', { key: 'label', className: `${SERVER_CLASS}-lead`, htmlFor: `${SERVER_CLASS}-password` },
        'Новый пароль — не короче 10 символов.'),
      React.createElement('div', { key: 'row', className: `${SERVER_CLASS}-row` }, [
        React.createElement('input', {
          key: 'password',
          id: `${SERVER_CLASS}-password`,
          className: `${SERVER_CLASS}-input`,
          type: 'password',
          autoComplete: 'new-password',
          spellCheck: false,
          placeholder: 'Новый пароль',
          value: password,
          disabled: saving,
          onChange: (event) => { setPassword(event.target.value) },
        }),
        React.createElement('input', {
          key: 'confirm',
          className: `${SERVER_CLASS}-input`,
          type: 'password',
          autoComplete: 'new-password',
          spellCheck: false,
          placeholder: 'Ещё раз',
          value: confirm,
          disabled: saving,
          onChange: (event) => { setConfirm(event.target.value) },
        }),
        React.createElement('button', {
          key: 'save',
          type: 'button',
          className: `${SERVER_CLASS}-button`,
          disabled: saving,
          onClick: savePassword,
        }, saving ? 'Сохраняем…' : 'Сохранить'),
      ]),
    ]),

    React.createElement('div', { key: 'restart-card', className: `${SERVER_CLASS}-card` }, [
      React.createElement('h3', { key: 'title', className: `${SERVER_CLASS}-title` }, 'Перезапуск'),
      React.createElement('p', { key: 'hint', className: `${SERVER_CLASS}-lead` },
        'Перезапускает сервер вместе с туннелем. Идущие ответы прервутся, страница переподключится сама.'),
      React.createElement('div', { key: 'row', className: `${SERVER_CLASS}-row` }, [
        React.createElement('button', {
          key: 'restart',
          type: 'button',
          className: `${SERVER_CLASS}-button`,
          disabled: restarting,
          onClick: restart,
        }, restarting ? 'Перезапускаем…' : 'Перезапустить сервер'),
        React.createElement('button', {
          key: 'reload-page',
          type: 'button',
          className: `${SERVER_CLASS}-button ${SERVER_CLASS}-secondary`,
          onClick: () => { window.location.reload() },
        }, 'Перезагрузить интерфейс'),
      ]),
    ]),

    note === null
      ? null
      : React.createElement('p', { key: 'note', className: `${SERVER_CLASS}-status`, 'data-tone': note.tone }, note.text),
  ])
}

/**
 * Зарегистрировать раздел «Сервер».
 * @param ctx - контекст браузерного плагина.
 */
function installServerAccessSection(ctx) {
  try {
    installServerAccessStyles()
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: SERVER_SECTION_ID,
      order: 41,
      label: () => 'Сервер',
      inject: () => ({}),
    }, ServerAccessSection))
  } catch (error) {
    console.warn(`dsh-mobile-ui: could not register the server settings section: ${String(error)}`)
  }
}
