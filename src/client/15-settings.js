// 15-settings.js — раздел «Mobile UI» в официальном диалоге настроек.
const React = require('react')

/** Id строки mobile-ui в cordis.patch.yml — он же namespace настроек на хосте. */
const SETTINGS_NAMESPACE = 'mobile-ui'

/** Имя поля в host-схеме Config. */
const TOKEN_FIELD = 'ngrokAuthtoken'

/** Поле с подписями к токенам: тот же порядок, через запятую. */
const NAMES_FIELD = 'ngrokAuthtokenNames'

/** Страница тарифов ngrok: что входит в план и какие лимиты. */
const PRICING_URL = 'https://ngrok.com/pricing'

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
 * Взять из снимка сохранённые подписи к токенам.
 * @param snapshot - снимок формы настроек.
 * @returns подписи через запятую или пустая строка.
 */
function storedNames(snapshot) {
  const section = snapshot.value
  if (section === undefined || section === null) return ''
  const value = section[NAMES_FIELD]
  return typeof value === 'string' ? value : ''
}

/**
 * Разложить сохранённое значение на строки редактора.
 *
 * Хост хранит пул токенов одной строкой через запятую (`src/host/ngrok-accounts.js`
 * понимает запятую, точку с запятой и пробелы). В интерфейсе это отдельные
 * строки, поэтому пустое значение превращается в одну пустую строку, а не в
 * пустой список — иначе некуда было бы вставлять первый токен.
 *
 * @param raw - значение настройки как есть.
 * @returns строки для отображения; минимум одна.
 */
function splitTokens(raw) {
  if (typeof raw !== 'string' || raw === '') return ['']
  const tokens = raw.split(/[\s,;]+/).map((token) => token.trim()).filter((token) => token !== '')
  return tokens.length === 0 ? [''] : tokens
}

/**
 * Собрать строки редактора обратно в значение настройки.
 * @param rows - строки редактора.
 * @returns токены через запятую, без пустых.
 */
function joinTokens(rows) {
  return rows.map((token) => token.trim()).filter((token) => token !== '').join(',')
}

/**
 * Разложить пул на строки «имя + токен».
 *
 * Подписи хранятся отдельной настройкой в том же порядке (см. `NAMES_FIELD`).
 * Строк берётся большее из двух количеств: так строка с одним именем или одним
 * токеном не теряется при редактировании.
 *
 * @param tokensRaw - токены как есть (через запятую).
 * @param namesRaw - подписи как есть (через запятую).
 * @returns строки редактора; минимум одна.
 */
function splitRows(tokensRaw, namesRaw) {
  const tokens = typeof tokensRaw === 'string' && tokensRaw === '' ? [] : splitTokens(tokensRaw)
  const names = typeof namesRaw === 'string' && namesRaw !== ''
    ? namesRaw.split(',').map((name) => name.trim())
    : []
  const count = Math.max(tokens.length, names.length, 1)
  const rows = []
  for (let index = 0; index < count; index += 1) {
    rows.push({ name: names[index] ?? '', token: tokens[index] ?? '' })
  }
  return rows
}

/**
 * Собрать строки «имя + токен» в две настройки сразу.
 * @param rows - строки редактора.
 * @returns значения полей токенов и подписей.
 */
function joinRows(rows) {
  const kept = rows.filter((row) => row.token.trim() !== '')
  return {
    tokens: kept.map((row) => row.token.trim()).join(','),
    // Запятая внутри имени сломала бы разбор — меняем на пробел.
    names: kept.map((row) => row.name.trim().replace(/,/g, ' ')).join(','),
  }
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
 * Значок карандаша (edit-2 из svgrepo).
 *
 * Стоит слева от имени токена и вместо слова «изменить» у расхода трафика.
 * Цвет — `currentColor`, иначе в тёмной теме оставался бы чёрным.
 *
 * @param props - `onClick`, `title`, `label` для доступного имени.
 */
function EditIcon(props) {
  return React.createElement('button', {
    type: 'button',
    className: `${SECTION_CLASS}-icon-btn`,
    title: props.title ?? 'Изменить',
    'aria-label': props.label ?? props.title ?? 'Изменить',
    onClick: (event) => {
      event.stopPropagation()
      if (typeof props.onClick === 'function') props.onClick(event)
    },
  }, React.createElement('svg', {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': 'true',
  }, [
    React.createElement('path', {
      key: 'pencil',
      d: 'M20.1497 7.93997L8.27971 19.81C7.21971 20.88 4.04971 21.3699 3.27971 20.6599C2.50971 19.9499 3.06969 16.78 4.12969 15.71L15.9997 3.84C16.5478 3.31801 17.2783 3.03097 18.0351 3.04019C18.7919 3.04942 19.5151 3.35418 20.0503 3.88938C20.5855 4.42457 20.8903 5.14781 20.8995 5.90463C20.9088 6.66146 20.6217 7.39189 20.0997 7.93997H20.1497Z',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
    React.createElement('path', {
      key: 'baseline',
      d: 'M21 21H12',
      stroke: 'currentColor',
      strokeWidth: 1.5,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  ]))
}

/**
 * Окно со ссылкой на туннель: адрес для копирования и порядок входа.
 * @param props - состояние туннеля и признак «токен задан».
 */
function TunnelLink(props) {
  const { status, hasToken } = props
  const linkRef = React.useRef(null)
  /** Номер аккаунта, на который переключаемся сейчас; -1 — не переключаемся. */
  const [switching, setSwitching] = React.useState(-1)
  const [note, setNote] = React.useState(null)

  /** Переключить туннель на другой аккаунт. */
  const switchTo = (index) => {
    if (switching !== -1) return
    setSwitching(index)
    setNote({ tone: 'muted', text: 'Переключаемся — туннель перезапускается…' })
    fetch('/mobile-ui/account', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ index }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(() => {
        setNote({ tone: 'ok', text: 'Переключено. Ссылка и QR обновятся через несколько секунд.' })
      })
      .catch(() => { setNote({ tone: 'bad', text: 'Не удалось переключить аккаунт.' }) })
      .finally(() => { setSwitching(-1) })
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
      React.createElement(CopyIcon, { key: 'copy', text: status.url }),
    ]),
    React.createElement('p', {
      key: 'password',
      className: `${SECTION_CLASS}-status`,
      'data-tone': status.passwordSet ? 'ok' : 'bad',
    }, status.passwordSet
      ? 'Пароль задан — телефон можно подключать.'
      : 'Пароль ещё не задан: задайте его ниже, иначе ссылку откроет любой, кто её знает.'),
    Array.isArray(status.links) && status.links.length > 1
      ? React.createElement('div', { key: 'accounts', className: `${SECTION_CLASS}-accounts` }, [
        React.createElement('p', { key: 'caption', className: `${SECTION_CLASS}-label` }, 'Ссылки по аккаунтам'),
        ...status.links.map((link) => React.createElement('div', {
          key: `account-${String(link.index)}`,
          className: `${SECTION_CLASS}-account`,
          'data-active': link.active ? 'true' : 'false',
          role: 'button',
          tabIndex: 0,
          title: link.active ? 'Этот аккаунт подключён' : `Переключиться на «${link.name}»`,
          onClick: () => { switchTo(link.index) },
          onKeyDown: (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              switchTo(link.index)
            }
          },
        }, [
          // Порядок слева направо: галочка, имя аккаунта, адрес, значок копирования.
          React.createElement('span', {
            key: 'check',
            className: `${SECTION_CLASS}-check`,
            'aria-hidden': 'true',
          }, '\u2713'),
          React.createElement('span', { key: 'name', className: `${SECTION_CLASS}-account-name` },
            link.name),
          link.url === ''
            ? React.createElement('span', { key: 'url', className: `${SECTION_CLASS}-status`, 'data-tone': 'muted' },
              link.active ? 'ссылка появится через несколько секунд…' : 'ссылка ещё не выдавалась')
            : React.createElement('a', {
              key: 'url',
              className: `${SECTION_CLASS}-link ${SECTION_CLASS}-account-url`,
              href: link.url,
              target: '_blank',
              rel: 'noreferrer',
              onClick: (event) => { event.stopPropagation() },
            }, link.url),
          link.url === ''
            ? null
            : React.createElement(CopyIcon, { key: 'copy', text: link.url }),
        ])),
        note === null ? null : React.createElement('p', {
          key: 'note',
          className: `${SECTION_CLASS}-status`,
          'data-tone': note.tone,
        }, note.text),
      ])
      : null,
  ])
}

/**
 * Расход трафика ngrok за месяц.
 *
 * Число считает relay, но он не видит байты самого ngrok (страница-предупреждение,
 * страницы ошибок) и трафик других проектов на том же аккаунте. Поэтому рядом с
 * полосой есть «изменить»: человек вводит значение из кабинета, и дальше счётчик
 * растёт уже от него.
 */
function UsagePanel() {
  const [usage, setUsage] = React.useState(null)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState('')
  const [saving, setSaving] = React.useState(false)
  const [note, setNote] = React.useState(null)

  /** Спросить хост о расходе. */
  const load = React.useCallback(() => {
    fetch('/mobile-ui/usage', { headers: { accept: 'application/json' } })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (data !== null) setUsage(data) })
      .catch(() => { /* хост не ответил — оставим прежние числа */ })
  }, [])

  React.useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    return () => { clearInterval(timer) }
  }, [load])

  /** Открыть правку: в поле подставляем текущее значение в мегабайтах. */
  const startEdit = () => {
    setEditing(true)
    setNote(null)
    setDraft(String(Math.round(Number(usage?.used ?? 0) / (1024 * 1024))))
  }

  /** Отправить актуальное значение из кабинета. */
  const save = () => {
    const megabytes = Number(String(draft).replace(',', '.'))
    if (!Number.isFinite(megabytes) || megabytes < 0) {
      setNote({ tone: 'bad', text: 'Введите число мегабайт, например 412.' })
      return
    }
    setSaving(true)
    fetch('/mobile-ui/usage', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ bytes: Math.round(megabytes * 1024 * 1024) }),
    })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then(() => {
        setEditing(false)
        setNote({ tone: 'ok', text: 'Значение сохранено — счётчик продолжит расти от него.' })
        load()
      })
      .catch(() => { setNote({ tone: 'bad', text: 'Не удалось сохранить значение.' }) })
      .finally(() => { setSaving(false) })
  }

  const used = Number(usage?.used ?? 0)
  const limit = Number(usage?.limit ?? 0)
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0
  const remaining = Math.max(0, 1 - ratio)
  const activeName = usage !== null && typeof usage.name === 'string' && usage.name !== '' ? usage.name : '—'

  return React.createElement('div', { className: `${SECTION_CLASS}-card` }, [
    React.createElement('p', { key: 'title', className: `${SECTION_CLASS}-label` },
      usage === null ? 'Трафик ngrok' : `Трафик ngrok · ${activeName}`),
    React.createElement('div', { key: 'track', className: `${SECTION_CLASS}-usage-track` }, [
      React.createElement('div', {
        key: 'fill',
        className: `${SECTION_CLASS}-usage-fill`,
        'data-level': levelFor(remaining),
        style: { width: `${Math.round(remaining * 100)}%` },
      }),
    ]),
    React.createElement('p', {
      key: 'facts',
      className: `${SECTION_CLASS}-status`,
      'data-tone': 'muted',
    }, usage === null
      ? 'Считаем расход…'
      : `${formatBytes(used)} из ${formatBytes(limit)} · осталось ${Math.round(remaining * 100)}% · аккаунт ${String(usage.account)} из ${String(usage.accounts)}`),
    editing
      ? React.createElement('div', { key: 'edit', className: `${SECTION_CLASS}-row` }, [
        React.createElement('input', {
          key: 'value',
          className: `${SECTION_CLASS}-input`,
          type: 'text',
          inputMode: 'decimal',
          value: draft,
          placeholder: 'Значение из кабинета, МБ',
          onChange: (event) => { setDraft(event.target.value) },
          onKeyDown: (event) => { if (event.key === 'Enter') save() },
        }),
        React.createElement('button', {
          key: 'apply',
          type: 'button',
          className: `${SECTION_CLASS}-button`,
          disabled: saving,
          onClick: save,
        }, saving ? 'Сохраняем…' : 'Сохранить'),
        React.createElement('button', {
          key: 'cancel',
          type: 'button',
          className: `${SECTION_CLASS}-copy`,
          disabled: saving,
          onClick: () => { setEditing(false); setNote(null) },
        }, 'отмена'),
      ])
      : React.createElement('div', { key: 'actions', className: `${SECTION_CLASS}-row` }, [
        // Вместо слова «изменить» — карандаш: он же стоит слева от имён токенов.
        React.createElement(EditIcon, {
          key: 'edit',
          title: 'Изменить расход вручную',
          label: 'Изменить расход вручную',
          onClick: startEdit,
        }),
      ]),
    note === null ? null : React.createElement('p', {
      key: 'note',
      className: `${SECTION_CLASS}-status`,
      'data-tone': note.tone,
    }, note.text),
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
  /** Строки редактора токенов; null — показываем сохранённое значение. */
  const [rows, setRows] = React.useState(null)
  const [saving, setSaving] = React.useState(false)
  const [refused, setRefused] = React.useState(false)
  const inputs = React.useRef([])
  /** Поля имён: карандаш в строке ставит в них курсор. */
  const nameInputs = React.useRef([])
  /** Добавили строку — надо поставить в неё курсор. */
  const [focusLast, setFocusLast] = React.useState(false)

  const stored = storedToken(snapshot)
  const storedNamesRaw = storedNames(snapshot)
  const rowsView = rows === null ? splitRows(stored, storedNamesRaw) : rows
  const ready = snapshot.status === 'ready'
  const writable = ready && snapshot.writable
  const joined = joinRows(rowsView)
  const changed = rows !== null && (joined.tokens !== stored || joined.names !== storedNamesRaw)
  const busy = saving || !writable

  // Новая строка появляется пустой и сразу с курсором: так в неё можно вставить
  // токен из буфера, не целясь мышью.
  React.useEffect(() => {
    if (!focusLast) return
    const node = inputs.current[rowsView.length - 1]
    if (node !== undefined && node !== null) node.focus()
    setFocusLast(false)
  }, [focusLast, rowsView.length])

  /** Изменить поле строки. */
  const update = (index, field, text) => {
    const next = rowsView.slice()
    next[index] = { ...next[index], [field]: text }
    setRows(next)
    setRefused(false)
  }

  /** Добавить пустую строку под новый аккаунт. */
  const addToken = () => {
    setRows([...rowsView, { name: '', token: '' }])
    setFocusLast(true)
  }

  /** Убрать строку; последнюю оставляем всегда. */
  const removeToken = (index) => {
    const next = rowsView.slice()
    next.splice(index, 1)
    setRows(next.length === 0 ? [{ name: '', token: '' }] : next)
    setRefused(false)
  }

  /** Сохранить имена и токены на хосте. */
  const save = () => {
    setSaving(true)
    setRefused(false)
    const payload = joinRows(rowsView)
    Promise.resolve(form.set(TOKEN_FIELD, payload.tokens))
      .then((acceptedTokens) => Promise.resolve(form.set(NAMES_FIELD, payload.names))
        .then((acceptedNames) => acceptedTokens !== false && acceptedNames !== false))
      .then((accepted) => {
        setSaving(false)
        setRefused(!accepted)
        if (accepted) setRows(null)
      })
      .catch(() => {
        setSaving(false)
        setRefused(true)
      })
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
      }, rowsView.length > 1 ? `Токены ngrok (${rowsView.length})` : 'Токен ngrok'),
      React.createElement('p', { key: 'note', className: `${SECTION_CLASS}-lead` },
        'Сначала имя — чтобы отличать аккаунты, потом сам токен. Когда у активного кончается трафик, плагин сам переключится на следующий.'),
      React.createElement('div', { key: 'tokens', className: `${SECTION_CLASS}-tokens` },
        rowsView.map((row, index) => React.createElement('div', {
          key: `token-${String(index)}`,
          className: `${SECTION_CLASS}-token-row`,
        }, [
          // Карандаш слева от имени: ставит курсор в поле имени этого аккаунта.
          React.createElement(EditIcon, {
            key: 'edit',
            title: `Переименовать аккаунт ${String(index + 1)}`,
            label: `Переименовать аккаунт ${String(index + 1)}`,
            onClick: () => {
              const node = nameInputs.current[index]
              if (node !== undefined && node !== null) {
                node.focus()
                node.select()
              }
            },
          }),
          React.createElement('input', {
            key: 'name',
            ref: (node) => { nameInputs.current[index] = node },
            className: `${SECTION_CLASS}-input ${SECTION_CLASS}-name`,
            type: 'text',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: `Имя ${String(index + 1)}`,
            value: row.name,
            disabled: busy,
            onChange: (event) => { update(index, 'name', event.target.value) },
          }),
          React.createElement('input', {
            key: 'input',
            ref: (node) => { inputs.current[index] = node },
            id: index === 0 ? `${SECTION_CLASS}-token` : `${SECTION_CLASS}-token-${String(index)}`,
            className: `${SECTION_CLASS}-input`,
            type: 'password',
            autoComplete: 'off',
            spellCheck: false,
            placeholder: index === 0 ? 'Вставьте authtoken' : `Authtoken аккаунта ${String(index + 1)}`,
            value: row.token,
            disabled: busy,
            onChange: (event) => { update(index, 'token', event.target.value) },
          }),
          rowsView.length > 1
            ? React.createElement('button', {
              key: 'remove',
              type: 'button',
              className: `${SECTION_CLASS}-remove`,
              title: 'Удалить токен',
              'aria-label': 'Удалить токен',
              disabled: busy,
              onClick: () => { removeToken(index) },
            }, '\u2715')
            : null,
        ].filter((node) => node !== null))),
      ),
      React.createElement('div', { key: 'add-row', className: `${SECTION_CLASS}-actions` }, [
        React.createElement('button', {
          key: 'add',
          type: 'button',
          className: `${SECTION_CLASS}-add`,
          disabled: busy,
          onClick: addToken,
        }, [
          React.createElement('span', { key: 'plus', className: `${SECTION_CLASS}-plus`, 'aria-hidden': 'true' }, '+'),
          React.createElement('span', { key: 'caption' }, 'Добавить токен'),
        ]),
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
    // Подпись над карточкой трафика: где смотреть сам тариф, а не только расход.
    React.createElement('p', { key: 'pricing', className: `${SECTION_CLASS}-lead` }, [
      'Актуальные данные тарифа находятся на ',
      React.createElement('a', {
        key: 'link',
        className: `${SECTION_CLASS}-link`,
        href: PRICING_URL,
        target: '_blank',
        rel: 'noreferrer',
      }, 'странице тарифов ngrok'),
      '.',
    ]),
    React.createElement(UsagePanel, { key: 'usage' }),
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
      // Первым в навигации настроек. Встроенные порядки: account -10,
      // general 0, models 10, plugins 15, agent-presets 20; было 40.
      order: -20,
      label: () => 'Mobile UI',
      inject: () => ({ form }),
    }, MobileTokenSection))
  } catch (error) {
    console.warn(`dsh-mobile-ui: could not register the settings section: ${String(error)}`)
  }
}
