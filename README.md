# dsh-plugin-mobile-ui

Мобильный доступ к DeepSeek Harness и Telegram-бот в одном плагине.

Плагин ставит перед локальным веб-интерфейсом защищённый паролем relay,
публикует его через **Cloudflare Tunnel** и добавляет мобильный слой поверх
официального интерфейса. Рядом живёт **Telegram-бот** на aiogram 3: он принимает
сообщения, запускает DSH-агента (инструменты, файлы, сессии) или отвечает напрямую
через DeepSeek API.

> **Language:** [Русский](#русский) · [English](#english)

---

<a name="русский"></a>
## Русский

### Что внутри

| Часть | Что делает |
|---|---|
| `dsh-mobile-ui/relay` | вход по паролю и TLS перед веб-сервером harness |
| `dsh-mobile-ui/tunnel` | именованный Cloudflare Tunnel — постоянный адрес вида `https://app.example.com` |
| `dsh-mobile-ui` | мобильный слой поверх официального веб-интерфейса |
| `Telegram Bot/` | бот на aiogram 3: DeepSeek, DSH-агент, файлы, сессии |

### Что нового в 3.7.0

- В настройках раздел **«Telegram API»** (первый): текущий бот, ссылка
  `https://t.me/<bot>`, поле токена и кнопка «Сохранить и перезапустить».
- Туннель, QR и пароль из настроек убраны: адрес туннеля пишется в
  `~/.dsh/tunnel-url.txt`, пароль и QR — на страницах relay
  (`/relay/password`, `/relay/pair`).
- Папка бота называется **`Telegram Bot`**.
- В консоли вместо ссылок relay/tunnel — строка **«Telegram-бот активен»**.

### Требования

| Требование | Зачем |
|---|---|
| DeepSeek Harness (`dsh web`) | для всего |
| Node.js `^22.19.0 \|\| >=24` | плагин |
| `cloudflared` | публичный туннель |
| домен в Cloudflare | постоянный адрес (Free plan) |
| Python 3.12 + aiogram 3 | Telegram-бот |

### Установка

#### 1. Cloudflare Tunnel

```powershell
cloudflared tunnel login
cloudflared tunnel create mobile-ui
cloudflared tunnel route dns mobile-ui app.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <UUID>
credentials-file: C:\Users\<Имя>\.cloudflared\<UUID>.json
protocol: http2

ingress:
  - hostname: app.example.com
    service: https://127.0.0.1:3443
  - service: http_status:404

originRequest:
  noTLSVerify: true
```

#### 2. Плагин

```bash
dsh plugin --profile web add github:dexwebcode/dsh-plugin-mobile-ui
```

#### 3. Профиль

`~/.dsh/profiles/web/cordis.patch.yml`:

```yaml
- id: relay
  name: 'dsh-mobile-ui/relay'
  config:
    publicHostnames: ['app.example.com']

- id: tunnel
  name: 'dsh-mobile-ui/tunnel'
  config:
    provider: cloudflared-named
    target: 'https://127.0.0.1:3443'

- id: mobile-ui
  name: 'dsh-mobile-ui'
  config:
    telegramConfigFile: 'C:\Users\<Имя>\...\dsh-plugin-mobile-ui\Telegram Bot\config.json'
```

#### 4. Telegram-бот

```powershell
$bot = 'C:\Users\<Имя>\...\dsh-plugin-mobile-ui\Telegram Bot'
uv venv "$bot\.venv" --python 3.12
uv pip install --python "$bot\.venv\Scripts\python.exe" -r "$bot\requirements.txt"
Copy-Item "$bot\config.example.json" "$bot\config.json"
# впишите botToken (из @BotFather) и deepseekApiKey (platform.deepseek.com)
python "$bot\bot.py" --check
```

#### 5. Токен через настройки

В веб-интерфейсе: **Настройки → Telegram API** → вставьте токен → «Сохранить и
перезапустить». Плагин проверит токен через `getMe`, запишет его в `config.json`
бота и поставит `.runtime/restart.flag` — бот переподключится к новому боту.

#### 6. Запуск и автозапуск бота

```powershell
Start-Process wscript.exe -ArgumentList "`"$bot\bot.vbs`""
```

- `bot.vbs` → `start.ps1` — супервизор: поднимает `bot.py` в скрытом окне и
  перезапускает через 10 с после падения.
- `ensure-bot.vbs` → `ensure-bot.ps1` — сторож: проверяет `/health`; если бот
  молчит дольше 10 минут — убивает процесс, супервизор поднимает заново.
- Задача **`DshTelegramBot`** запускает сторожа при входе и каждые 5 минут.
- Ярлык автозагрузки `telegram-bot.vbs` поднимает супервизор при входе.

```powershell
$a = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument "`"$bot\ensure-bot.vbs`""
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'DshTelegramBot' -Action $a -Trigger @($t1, $t2) -Force
```

### Telegram-бот

Кнопки внизу чата: **Модель**, **Доступ**, **Новая сессия**, **Статус**,
**Обновить**. «Обновить» (и `/update`) перезапускает бота, чтобы он подхватил
правки кода.

| Команда | Что делает |
|---|---|
| `/status` | состояние бота, модель, усилие, доступ |
| `/new` | новая сессия агента |
| `/cancel` | остановить текущий ход |
| `/update` | перезапуск бота |

Права агента: `read-only`, `workspace-write`, `danger-full-access` — выбираются
на каждый чат и запоминаются в `state.json`. В режимах с подтверждением бот
присылает кнопки «Разрешить» / «Отменить».

Файлы бота: `bot.py`, `backends.py`, `formatting.py`, `config.json`,
`state.json`, `start.ps1`, `bot.vbs`, `ensure-bot.ps1`, `ensure-bot.vbs`,
`logs/`.

### Диагностика

| Симптом | Причина / что делать |
|---|---|
| в настройках «Не удалось прочитать настройки» | не задан `telegramConfigFile` или harness не перезапущен |
| бот молчит, `/health` не отвечает | процесс упал: сторож поднимет в течение 5 минут, лог — `logs/watchdog.log` |
| `409 Conflict` | этого бота поллит кто-то ещё: остановите лишние процессы |
| бот не подключается к новому токену | проверьте `config.json` и `.runtime/restart.flag` |
| нет публичной ссылки | `~/.dsh/tunnel-url.txt`; проверьте `cloudflared tunnel list` |

### Безопасность

- `Telegram Bot/config.json` содержит токен бота и ключ DeepSeek — **не
  коммитьте его** (он в `.gitignore`).
- Публичный адрес защищён паролем relay; задайте его на
  `https://127.0.0.1:3443/relay/password`.
- `danger-full-access` даёт боту доступ к компьютеру: для чужих чатов ставьте
  `workspace-write` или `read-only`.

### Обновление

```bash
dsh plugin --profile web add github:dexwebcode/dsh-plugin-mobile-ui
```

Новый код подхватывается после перезапуска `dsh web` (host-маршруты) и
обновления страницы (клиент).

---

<a name="english"></a>
## English

Mobile access for DeepSeek Harness plus a Telegram bot, in one plugin: a
password-protected relay and a named Cloudflare Tunnel in front of the web UI, a
phone-adapted layer over the official interface, and a Python aiogram bot.

Version **3.7.0** adds the **Telegram API** settings section (bot token, `getMe`
validation, `config.json` update, restart flag), renames the bot folder to
`Telegram Bot`, and replaces relay/tunnel console links with a single
`Telegram-бот активен` line.

Requirements: DSH (`dsh web`), Node `^22.19 || >=24`, `cloudflared`, a Cloudflare
domain, Python 3.12 + aiogram 3.

Quick start:

1. `cloudflared tunnel login && cloudflared tunnel create mobile-ui`.
2. Write `~/.cloudflared/config.yml` (ingress `app.example.com → https://127.0.0.1:3443`).
3. `dsh plugin --profile web add github:dexwebcode/dsh-plugin-mobile-ui`.
4. Set the `relay`, `tunnel` and `mobile-ui.telegramConfigFile` rows in
   `~/.dsh/profiles/web/cordis.patch.yml`.
5. Copy `Telegram Bot/config.example.json` to `config.json` and fill in the bot
   token and DeepSeek key.
6. `dsh web` → Settings → **Telegram API** → paste the token → save.
7. Start the bot: `wscript "$bot\bot.vbs"`.

### License

[MIT](LICENSE) © 2026 DEXWEBCODE
