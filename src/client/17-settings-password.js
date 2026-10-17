// 17-settings-password.js — панель смены пароля на вход.
//
// Пароль хранит и проверяет вшитый relay; панель только собирает его и передаёт
// хосту, который повторяет запрос от лица петлевого клиента. Проверки длины и
// совпадения сделаны здесь же, чтобы человек получил ответ сразу.

/** Стили панели пароля. */
const PASSWORD_STYLE = `
.${SECTION_CLASS}-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.${SECTION_CLASS}-field .${SECTION_CLASS}-input {
  flex: 0 0 auto;
  width: 100%;
}
`

/**
 * Панель смены пароля.
 * @param props - `status` нужен, чтобы показать, задан ли пароль сейчас.
 */
function PasswordPanel(props) {
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(null)

  const ready = password.length >= PASSWORD_MIN_LENGTH && password === confirm

  /** Отправить новый пароль хосту. */
  const submit = () => {
    setBusy(true)
    setResult(null)
    fetch(PASSWORD_PATH, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ password, confirm }),
    })
      .then((response) => (response.ok ? response.json() : { ok: false, message: `Хост ответил кодом ${String(response.status)}.` }))
      .then((data) => {
        setBusy(false)
        setResult(data)
        if (data.ok === true) {
          setPassword('')
          setConfirm('')
        }
      })
      .catch(() => {
        setBusy(false)
        setResult({ ok: false, message: 'Хост не ответил — попробуйте ещё раз.' })
      })
  }

  return React.createElement('div', { className: `${SECTION_CLASS}-card` }, [
    React.createElement('p', { key: 'title', className: `${SECTION_CLASS}-label` }, 'Пароль для входа'),
    React.createElement('p', { key: 'hint', className: `${SECTION_CLASS}-lead` },
      'Пароль спрашивают при входе с телефона — и по ссылке, и на странице relay. Минимум 10 символов.'),
    props.status !== undefined && props.status.passwordSet === true
      ? React.createElement('p', {
        key: 'state',
        className: `${SECTION_CLASS}-status`,
        'data-tone': 'ok',
      }, 'Пароль уже задан. Новый заменит его.')
      : React.createElement('p', {
        key: 'state',
        className: `${SECTION_CLASS}-status`,
        'data-tone': 'bad',
      }, 'Пароля пока нет: без него ссылку откроет любой, кто её знает.'),
    React.createElement('div', { key: 'new', className: `${SECTION_CLASS}-field` }, [
      React.createElement('label', {
        key: 'label',
        className: `${SECTION_CLASS}-label`,
        htmlFor: `${SECTION_CLASS}-password`,
      }, 'Новый пароль'),
      React.createElement('input', {
        key: 'input',
        id: `${SECTION_CLASS}-password`,
        className: `${SECTION_CLASS}-input`,
        type: 'password',
        autoComplete: 'new-password',
        value: password,
        disabled: busy,
        onChange: (event) => { setPassword(event.target.value) },
      }),
    ]),
    React.createElement('div', { key: 'confirm', className: `${SECTION_CLASS}-field` }, [
      React.createElement('label', {
        key: 'label',
        className: `${SECTION_CLASS}-label`,
        htmlFor: `${SECTION_CLASS}-confirm`,
      }, 'Повторите пароль'),
      React.createElement('input', {
        key: 'input',
        id: `${SECTION_CLASS}-confirm`,
        className: `${SECTION_CLASS}-input`,
        type: 'password',
        autoComplete: 'new-password',
        value: confirm,
        disabled: busy,
        onChange: (event) => { setConfirm(event.target.value) },
      }),
    ]),
    React.createElement('div', { key: 'actions', className: `${SECTION_CLASS}-row` }, [
      React.createElement('button', {
        key: 'submit',
        type: 'button',
        className: `${SECTION_CLASS}-button`,
        disabled: busy || !ready,
        onClick: submit,
      }, busy ? 'Сохраняем…' : 'Сменить пароль'),
      result === null
        ? React.createElement('p', {
          key: 'note',
          className: `${SECTION_CLASS}-status`,
          'data-tone': 'muted',
        }, password.length > 0 && password.length < PASSWORD_MIN_LENGTH
          ? `Ещё ${String(PASSWORD_MIN_LENGTH - password.length)} символов до минимума.`
          : password !== confirm
            ? 'Пароли пока не совпадают.'
            : '')
        : React.createElement('p', {
          key: 'note',
          className: `${SECTION_CLASS}-status`,
          'data-tone': result.ok === true ? 'ok' : 'bad',
        }, result.message),
    ]),
  ])
}
