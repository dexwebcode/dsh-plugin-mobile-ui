// 15-settings.js — раздел «Mobile UI» в официальном диалоге настроек.
const React = require('react')

/** Id строки mobile-ui в cordis.patch.yml — он же namespace настроек на хосте. */
const SETTINGS_NAMESPACE = 'mobile-ui'

/** Имя поля в host-схеме Config. */
const TOKEN_FIELD = 'ngrokAuthtoken'

/** Страница, где ngrok выдаёт authtoken. */
const TOKEN_URL = 'https://dashboard.ngrok.com/get-started/your-authtoken'

/** Маршрут состояния туннеля на веб-сервере harness. */
const STATUS_PATH = '/mobile-ui/status'

/** Как часто переспрашивать хост про ссылку. */
const STATUS_POLL_MS = 3000

/** Маршрут приглашения для телефона: QR и одноразовый код. */
const PAIR_PATH = '/mobile-ui/pair'

/** Маршрут выпуска нового кода подключения. */
const NEW_CODE_PATH = '/mobile-ui/pair/new'

/** Маршрут смены пароля на вход. */
const PASSWORD_PATH = '/mobile-ui/password'

/** Минимальная длина пароля — то же правило, что и у relay. */
const PASSWORD_MIN_LENGTH = 10

/** Класс корня секции; он же префикс её элементов. */
const SECTION_CLASS = 'dsh-mobile-token'

/** Атрибут-маркер своего блока стилей. */
const STYLE_ATTR = 'data-dsh-mobile-ui-settings'

/** Локальный адрес, с которого настройки вообще сохраняются. */
const LOOPBACK_URL = 'http://127.0.0.1:3080'

/**
 * Стили секции. Лежат отдельно от мобильного набора: те включаются только на
 * узком экране, а настройки нужны на любой ширине. Цвета берутся из токенов
 * темы harness, поэтому секция следует за светлой и тёмной темой.
 */
const SECTION_STYLE = `
.${SECTION_CLASS} {
  max-width: 640px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  color: var(--dsw-alias-label-primary, #0f1115);
  font-size: 14px;
  line-height: 1.55;
}
.${SECTION_CLASS}-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.${SECTION_CLASS}-lead {
  margin: 0;
  color: var(--dsw-alias-label-secondary, #61666b);
}
.${SECTION_CLASS}-label {
  display: block;
  margin-bottom: 6px;
  font-weight: 500;
}
.${SECTION_CLASS}-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.${SECTION_CLASS}-input {
  flex: 1 1 260px;
  min-width: 0;
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%));
  border-radius: 8px;
  background: var(--dsw-alias-bg-base, #fff);
  color: inherit;
  font: inherit;
}
.${SECTION_CLASS}-input:focus {
  outline: 2px solid var(--dsw-alias-brand-primary, #4d6bfe);
  outline-offset: 1px;
}
.${SECTION_CLASS}-input:disabled {
  opacity: 0.6;
}
.${SECTION_CLASS}-button {
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
.${SECTION_CLASS}-button:disabled {
  opacity: 0.5;
  cursor: default;
}
.${SECTION_CLASS}-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1, rgb(0 0 0 / 3%));
}
.${SECTION_CLASS}-status {
  margin: 0;
  font-size: 13px;
}
.${SECTION_CLASS}-status[data-tone='ok'] { color: var(--dsw-alias-state-success-primary, #22c55e); }
.${SECTION_CLASS}-status[data-tone='bad'] { color: var(--dsw-alias-state-error-primary, #ef4444); }
.${SECTION_CLASS}-status[data-tone='muted'] { color: var(--dsw-alias-label-secondary, #61666b); }
.${SECTION_CLASS}-link { color: var(--dsw-alias-brand-primary, #4d6bfe); }
`

/** Поставить блок стилей секции, если его ещё нет. */
function installSettingsStyles() {
  if (document.querySelector(`style[${STYLE_ATTR}]`) !== null) return
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_ATTR, '')
  // Стили панелей лежат рядом с панелями (см. `16-settings-pair.js` и
  // `17-settings-password.js`); здесь они только собираются в один блок.
  tag.textContent = SECTION_STYLE + PAIR_STYLE + PASSWORD_STYLE
  document.head.appendChild(tag)
}

/**
 * Читать настройки так, как это делает React: снимок плюс подписка на замену.
 * @param form - контроллер формы одного namespace настроек.
 * @returns текущий снимок формы.
 */
function useFormSnapshot(form) {
  const [snapshot, setSnapshot] = React.useState(() => form.getSnapshot())
  React.useEffect(() => {
    setSnapshot(form.getSnapshot())
    return form.subscribe(() => { setSnapshot(form.getSnapshot()) })
  }, [form])
  return snapshot
}

/**
 * Следить за состоянием публичного доступа.
 *
 * Ссылку выдаёт туннель, поэтому она появляется не сразу: хост спрашивают
 * повторно, пока он не ответит адресом.
 *
 * @returns ссылка туннеля, провайдер, признак пароля и адрес страницы пароля.
 */
function useTunnelStatus() {
  const [status, setStatus] = React.useState({ url: '', provider: '', passwordSet: false, passwordUrl: '' })
  React.useEffect(() => {
    let cancelled = false
    /** Спросить хост о текущем состоянии туннеля. */
    const poll = () => {
      fetch(STATUS_PATH, { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => { if (!cancelled && data !== null) setStatus(data) })
        .catch(() => { /* хост ещё не ответил — повторим на следующем шаге */ })
    }
    poll()
    const timer = setInterval(poll, STATUS_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  return status
}

/**
 * Взять из снимка сохранённый токен.
 * @param snapshot - снимок формы настроек.
 * @returns токен или пустая строка.
 */
function storedToken(snapshot) {
  const section = snapshot.value
  if (section === undefined || section === null) return ''
  const value = section[TOKEN_FIELD]
  return typeof value === 'string' ? value : ''
}

/**
 * Подсказка под полем токена: что произошло и что делать дальше.
 * @param state - снимок формы, признак отказа и признак несохранённой правки.
 * @returns текст и тон подсказки.
 */
function hintFor(state) {
  const { snapshot, refused, changed, stored } = state
  if (refused) return { tone: 'bad', text: 'Хост отклонил запись — токен не сохранён. Попробуйте ещё раз.' }
  if (snapshot.status === 'unavailable' || snapshot.mode !== 'host') {
    return {
      tone: 'bad',
      text: `Настройки сохраняются только с этого компьютера. Откройте ${LOOPBACK_URL} и введите токен там.`,
    }
  }
  if (snapshot.status !== 'ready') return { tone: 'muted', text: 'Загружаем настройки…' }
  if (changed) return { tone: 'muted', text: 'Есть несохранённые изменения.' }
  if (stored !== '') return { tone: 'ok', text: 'Токен сохранён.' }
  return { tone: 'muted', text: 'Токен ещё не задан — без него ngrok не поднимет ссылку.' }
}

/**
 * Человеческое имя провайдера туннеля.
 * @param provider - значение из настроек хоста.
 * @returns подпись для интерфейса.
 */
function providerLabel(provider) {
  if (provider === 'ngrok') return 'ngrok'
  if (provider === 'cloudflared') return 'Cloudflare (cloudflared)'
  return provider === '' || provider === undefined ? 'неизвестен' : String(provider)
}

/**
 * Окно со ссылкой на туннель: адрес для копирования и порядок входа.
 * @param props - состояние туннеля и признак «токен задан».
 */
function TunnelLink(props) {
  const { status, hasToken } = props
  const [copied, setCopied] = React.useState(false)
  const linkRef = React.useRef(null)

  /** Положить ссылку в буфер обмена. */
  const copy = () => {
    const done = () => {
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    }
    // Буфер обмена есть не всегда (незащищённый контекст, старый браузер):
    // тогда просто выделяем текст, чтобы человек скопировал его сам.
    if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(status.url).then(done, () => {
        if (linkRef.current !== null) linkRef.current.select()
      })
      return
    }
    if (linkRef.current !== null) linkRef.current.select()
  }

  if (status.url === '') {
    return React.createElement('div', { className: `${SECTION_CLASS}-card` }, [
      React.createElement('p', { key: 'title', className: `${SECTION_CLASS}-label` }, 'Туннель'),
      React.createElement('p', {
        key: 'waiting',
        className: `${SECTION_CLASS}-status`,
        'data-tone': 'muted',
      }, hasToken
        ? 'Туннель поднимается — ссылка появится через несколько секунд…'
        : 'Ссылка появится, как только вы сохраните токен.'),
    ])
  }

  return React.createElement('div', { className: `${SECTION_CLASS}-card` }, [
    React.createElement('p', { key: 'title', className: `${SECTION_CLASS}-label` }, 'Туннель'),
    React.createElement('p', {
      key: 'facts',
      className: `${SECTION_CLASS}-status`,
      'data-tone': 'muted',
    }, `Провайдер: ${providerLabel(status.provider)}`),
    React.createElement('div', { key: 'row', className: `${SECTION_CLASS}-row` }, [
      React.createElement('input', {
        key: 'link',
        ref: linkRef,
        className: `${SECTION_CLASS}-input`,
        type: 'text',
        readOnly: true,
        value: status.url,
        onFocus: (event) => { event.target.select() },
      }),
      React.createElement('button', {
        key: 'copy',
        type: 'button',
        className: `${SECTION_CLASS}-button`,
        onClick: copy,
      }, copied ? 'Скопировано' : 'Копировать'),
    ]),
    React.createElement('p', {
      key: 'password',
      className: `${SECTION_CLASS}-status`,
      'data-tone': status.passwordSet ? 'ok' : 'bad',
    }, status.passwordSet
      ? 'Пароль задан — телефон можно подключать.'
      : 'Пароль ещё не задан: задайте его ниже, иначе ссылку откроет любой, кто её знает.'),
  ])
}

/**
 * Раздел настроек: объяснение, поле токена и окно со ссылкой.
 * @param props - `form` приходит из inject-лица слота.
 */
function MobileTokenSection(props) {
  const form = props.form
  const snapshot = useFormSnapshot(form)
  const status = useTunnelStatus()
  const [draft, setDraft] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [refused, setRefused] = React.useState(false)

  const stored = storedToken(snapshot)
  const value = draft === null ? stored : draft
  const ready = snapshot.status === 'ready'
  const writable = ready && snapshot.writable
  const changed = draft !== null && draft !== stored
  const busy = saving || !writable

  /** Сохранить введённый токен на хосте. */
  const save = () => {
    setSaving(true)
    setRefused(false)
    Promise.resolve(form.set(TOKEN_FIELD, value)).then(
      (accepted) => {
        setSaving(false)
        setRefused(!accepted)
        if (accepted) setDraft(null)
      },
      () => {
        setSaving(false)
        setRefused(true)
      },
    )
  }

  const hint = hintFor({ snapshot, refused, changed, stored })

  return React.createElement('div', { className: SECTION_CLASS }, [
    React.createElement('h3', { key: 'title', className: `${SECTION_CLASS}-title` },
      'DeepSeek Harness mobile UI'),
    React.createElement('p', { key: 'lead', className: `${SECTION_CLASS}-lead` },
      'Чтобы пользоваться DeepSeek Harness с телефона, добавьте свой токен с официального сайта ngrok — он бесплатный. Плагин даст вам ссылку, по которой DeepSeek Harness будет доступен для мобильного пользования.'),
    React.createElement('div', { key: 'field' }, [
      React.createElement('label', {
        key: 'label',
        className: `${SECTION_CLASS}-label`,
        htmlFor: `${SECTION_CLASS}-token`,
      }, 'Токен ngrok'),
      React.createElement('div', { key: 'row', className: `${SECTION_CLASS}-row` }, [
        React.createElement('input', {
          key: 'input',
          id: `${SECTION_CLASS}-token`,
          className: `${SECTION_CLASS}-input`,
          type: 'password',
          autoComplete: 'off',
          spellCheck: false,
          placeholder: 'Вставьте authtoken',
          value,
          disabled: busy,
          onChange: (event) => {
            setRefused(false)
            setDraft(event.target.value)
          },
        }),
        React.createElement('button', {
          key: 'save',
          type: 'button',
          className: `${SECTION_CLASS}-button`,
          disabled: busy || !changed,
          onClick: save,
        }, saving ? 'Сохраняем…' : 'Сохранить'),
      ]),
    ]),
    React.createElement('p', {
      key: 'status',
      className: `${SECTION_CLASS}-status`,
      'data-tone': hint.tone,
    }, hint.text),
    React.createElement('p', { key: 'where', className: `${SECTION_CLASS}-lead` }, [
      'Токен выдаётся бесплатно: ',
      React.createElement('a', {
        key: 'link',
        className: `${SECTION_CLASS}-link`,
        href: TOKEN_URL,
        target: '_blank',
        rel: 'noreferrer',
      }, 'страница authtoken в кабинете ngrok'),
      '.',
    ]),
    React.createElement(TunnelLink, { key: 'tunnel', status, hasToken: stored !== '' }),
    React.createElement(PairPanel, { key: 'pair', hasToken: stored !== '' }),
    React.createElement(PasswordPanel, { key: 'password', status }),
  ])
}

/**
 * Зарегистрировать раздел настроек.
 * @param ctx - контекст браузерного плагина.
 */
function installSettingsSection(ctx) {
  try {
    installSettingsStyles()
    const form = ctx.configForms.get(SETTINGS_NAMESPACE)
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: SETTINGS_NAMESPACE,
      order: 40,
      label: () => 'Mobile UI',
      inject: () => ({ form }),
    }, MobileTokenSection))
  } catch (error) {
    console.warn(`dsh-mobile-ui: could not register the settings section: ${String(error)}`)
  }
}
