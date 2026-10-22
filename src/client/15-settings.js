// 15-settings.js — раздел «Mobile UI» в официальном диалоге настроек.
const React = require('react')

/** Id строки mobile-ui в cordis.patch.yml — он же namespace настроек на хосте. */
const SETTINGS_NAMESPACE = 'mobile-ui'

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
const STYLE_ATTR = 'data-dsh-plugin-mobile-ui-settings'

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
.${SECTION_CLASS}-tokens {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.${SECTION_CLASS}-token-row {
  display: grid;
  grid-template-columns: auto minmax(96px, 0.7fr) minmax(0, 2fr) auto;
  align-items: center;
  gap: 8px;
}
.${SECTION_CLASS}-name {
  min-width: 0;
}
/* Кнопки «Добавить токен» и «Сохранить» стоят в одном ряду и растянуты:
   раньше они были прижаты друг к другу и читались как одна сдвоенная кнопка. */
.${SECTION_CLASS}-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 8px;
}
.${SECTION_CLASS}-actions > * {
  flex: 1 1 160px;
  height: 38px;
}
.${SECTION_CLASS}-accounts {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 4px;
  padding-top: 10px;
  border-top: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 12%));
}
/* Строка аккаунта — кнопка: по ней переключают туннель. Оформлена как поле
   ввода (светлая подложка, тонкая рамка, скругление), поэтому в блоке ссылок она
   читается как строка ввода, а не как абзац текста. Активная обведена зелёным,
   слева у неё галочка; место под галочку есть всегда, чтобы строки не прыгали.
   Порядок слева направо: галочка, имя, адрес, значок копирования. Всё в одну
   строку, поэтому имя и адрес обрезаются многоточием. */
.${SECTION_CLASS}-account {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: var(--dsw-alias-bg-base, #fff);
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%));
  border-radius: 10px;
  cursor: pointer;
  transition: border-color 150ms ease;
}
.${SECTION_CLASS}-account:hover {
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
}
.${SECTION_CLASS}-account[data-active='true'] {
  border-color: #22c55e;
}
.${SECTION_CLASS}-check {
  flex: none;
  width: 16px;
  /* Галочка тянется на всю высоту строки и центрирует знак внутри себя: сам
     глиф «✓» сидит выше середины своей строки, и при обычном выравнивании
     казался приподнятым. */
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #22c55e;
  font-weight: 700;
  font-size: 15px;
  line-height: 1;
  opacity: 0;
}
.${SECTION_CLASS}-account[data-active='true'] .${SECTION_CLASS}-check {
  opacity: 1;
}
.${SECTION_CLASS}-account-name {
  flex: 0 1 auto;
  max-width: 42%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.${SECTION_CLASS}-account-url {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
/* Значок копирования: кнопка-квадрат у правого края строки. */
.${SECTION_CLASS}-icon-btn {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  opacity: 0.5;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
}
.${SECTION_CLASS}-icon-btn:hover,
.${SECTION_CLASS}-icon-btn:focus-visible {
  opacity: 1;
  background: rgb(128 128 128 / 12%);
}
/* «Копировать» — второстепенное действие: слово без рамки, полупрозрачное,
   проявляется при наведении. Большая кнопка рядом с адресом спорила с самим
   адресом и занимала половину строки. */
.${SECTION_CLASS}-copy {
  flex: none;
  /* Прижимаем к правому краю строки: в ней же стоит адрес, который может быть
     длинным, поэтому место под слово резервируется, а не отбирается у текста. */
  margin-left: auto;
  /* Слово стоит по середине высоты строки при любом содержимом рядом: у адреса
     может быть одна строка, у имени аккаунта — две. Тянемся на всю высоту и
     центрируем текст внутри, вместо выравнивания по базовой линии. */
  align-self: stretch;
  display: inline-flex;
  align-items: center;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  opacity: 0.45;
  cursor: pointer;
  white-space: nowrap;
  text-decoration: underline dotted;
  /* Иначе браузер рисует вокруг слова свою кнопку с рамкой и фоном. */
  appearance: none;
  -webkit-appearance: none;
}
.${SECTION_CLASS}-copy:hover,
.${SECTION_CLASS}-copy:focus-visible {
  opacity: 1;
}
.${SECTION_CLASS}-remove {
  flex: none;
  width: 34px;
  height: 34px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l2, rgb(0 0 0 / 16%));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.${SECTION_CLASS}-remove:disabled { opacity: 0.5; cursor: default; }
/* Кнопка «＋ Добавить токен»: пунктирная рамка, чтобы читалась как «добавить
   строку», а не как обычное действие. */
.${SECTION_CLASS}-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 14px;
  border: 1px dashed var(--dsw-alias-border-l2, rgb(0 0 0 / 24%));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.${SECTION_CLASS}-add:hover {
  border-color: var(--dsw-alias-brand-primary, #4d6bfe);
  color: var(--dsw-alias-brand-primary, #4d6bfe);
}
.${SECTION_CLASS}-add:disabled { opacity: 0.5; cursor: default; }
.${SECTION_CLASS}-plus { font-size: 18px; line-height: 1; }
.${SECTION_CLASS}-usage-track {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: rgb(128 128 128 / 22%);
  overflow: hidden;
}
.${SECTION_CLASS}-usage-fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 999px;
  background: #22c55e;
  transition: width 400ms ease, background-color 400ms ease;
}
.${SECTION_CLASS}-usage-fill[data-level='warn'] { background: #f59e0b; }
.${SECTION_CLASS}-usage-fill[data-level='bad'] { background: #ef4444; }
`

/** Поставить блок стилей секции, если его ещё нет. */
function installSettingsStyles() {
  if (document.querySelector(`style[${STYLE_ATTR}]`) !== null) return
  const tag = document.createElement('style')
  tag.setAttribute(STYLE_ATTR, '')
  // Стили панелей лежат рядом с панелями (см. `16-settings-pair.js`,
  // `17-settings-password.js` и `20-settings-telegram.js`); здесь они только
  // собираются в один блок.
  tag.textContent = SECTION_STYLE + PAIR_STYLE + PASSWORD_STYLE + TELEGRAM_STYLE
  document.head.appendChild(tag)
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
 * Человеческое имя провайдера туннеля.
 * @param provider - значение из настроек хоста.
 * @returns подпись для интерфейса.
 */
function providerLabel(provider) {
  if (provider === 'cloudflared' || provider === 'cloudflared-named') return 'Cloudflare (cloudflared)'
  return provider === '' || provider === undefined ? 'неизвестен' : String(provider)
}

/**
 * Положить текст в буфер обмена.
 *
 * `navigator.clipboard` есть не всегда (незащищённый контекст, старый браузер) —
 * тогда работает откат через скрытое поле и `execCommand`.
 *
 * @param text - что копируем.
 * @param done - что сделать после успеха.
 */
function copyToClipboard(text, done) {
  if (navigator.clipboard !== undefined && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).then(done, () => {})
    return
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
    done()
  } catch {
    /* не смогли — человек выделит адрес сам */
  }
}

/**
 * Значок копирования — единственное представление действия «копировать».
 *
 * Рисунок взят из набора svgrepo (две плашки, заливка). Цвет заменён на
 * `currentColor`: иначе иконка оставалась бы чёрной в тёмной теме. После нажатия
 * на 1.5 секунды превращается в галочку — это и есть подтверждение.
 *
 * @param props - `text` для копирования.
 */
function CopyIcon(props) {
  const [done, setDone] = React.useState(false)

  /** Скопировать текст и мигнуть галочкой. */
  const copy = () => {
    copyToClipboard(props.text, () => {
      setDone(true)
      window.setTimeout(() => { setDone(false) }, 1500)
    })
  }

  const glyph = done
    ? React.createElement('path', {
      key: 'ok',
      d: 'M20 6 9 17l-5-5',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    })
    : React.createElement('g', { key: 'copy' }, [
      React.createElement('path', {
        key: 'sheet',
        fillRule: 'evenodd',
        clipRule: 'evenodd',
        d: 'M21 8C21 6.34315 19.6569 5 18 5H10C8.34315 5 7 6.34315 7 8V20C7 21.6569 8.34315 23 10 23H18C19.6569 23 21 21.6569 21 20V8ZM19 8C19 7.44772 18.5523 7 18 7H10C9.44772 7 9 7.44772 9 8V20C9 20.5523 9.44772 21 10 21H18C18.5523 21 19 20.5523 19 20V8Z',
        fill: 'currentColor',
      }),
      React.createElement('path', {
        key: 'edge',
        d: 'M6 3H16C16.5523 3 17 2.55228 17 2C17 1.44772 16.5523 1 16 1H6C4.34315 1 3 2.34315 3 4V18C3 18.5523 3.44772 19 4 19C4.55228 19 5 18.5523 5 18V4C5 3.44772 5.44772 3 6 3Z',
        fill: 'currentColor',
      }),
    ])

  return React.createElement('button', {
    type: 'button',
    className: `${SECTION_CLASS}-icon-btn`,
    title: done ? 'Скопировано' : 'Скопировать ссылку',
    'aria-label': 'Скопировать ссылку',
    onClick: (event) => {
      // Строка аккаунта переключает туннель: копирование не должно этого делать.
      event.stopPropagation()
      copy()
    },
  }, React.createElement('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': 'true',
  }, glyph))
}

/**
 * Окно со ссылкой на туннель: адрес для копирования и порядок входа.
 * @param props - состояние туннеля и признак «токен задан».
 */
function TunnelLink(props) {
  const { status, hasToken } = props

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
        className: `${SECTION_CLASS}-input`,
        type: 'text',
        readOnly: true,
        value: status.url,
        onFocus: (event) => { event.target.select() },
      }),
      React.createElement(CopyIcon, { key: 'copy', text: status.url }),
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
 * Раздел настроек: только подключение Telegram-бота.
 */
function MobileTokenSection() {
  return React.createElement('div', { className: SECTION_CLASS }, [
    React.createElement(TelegramPanel, { key: 'telegram' }),
  ])
}

/**
 * Зарегистрировать раздел настроек.
 * @param ctx - контекст браузерного плагина.
 */
function installSettingsSection(ctx) {
  try {
    installSettingsStyles()
    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section',
      id: SETTINGS_NAMESPACE,
      // Первым в навигации настроек. Встроенные порядки: account -10,
      // general 0, models 10, plugins 15, agent-presets 20; было 40.
      order: -20,
      label: () => 'Telegram API',
      inject: () => ({}),
    }, MobileTokenSection))
  } catch (error) {
    console.warn(`dsh-plugin-mobile-ui: could not register the settings section: ${String(error)}`)
  }
}
