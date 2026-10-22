# DeepSeek Telegram Bot

Telegram-бот на **aiogram 3** к DeepSeek и DeepSeek Harness. Принимает сообщение,
отправляет его «мозгу» и возвращает ответ в чат с сохранением контекста. Ответы
приходят в **MarkdownV2**.

```
Telegram ──long polling──▶ bot.py ──▶ DeepSeek API / DSH-агент ──▶ ответ в чат
```

## Что умеет

- **Два режима:**
  - `agent` (по умолчанию) — запускает DSH-агента (`dsh headless --json`): инструменты,
    файлы, рабочая папка, сессии — как в веб-интерфейсе DSH;
  - `fast` — прямой запрос к `api.deepseek.com`, без инструментов и файлов.
- **Модель и усилие на каждый чат:** Flash/Pro, Low/High/Max — запоминаются в
  `state.json`.
- **Права на каждый чат:** `read-only`, `workspace-write`, `danger-full-access`;
  в режимах с подтверждением бот присылает кнопки «Разрешить» / «Отменить».
- **Живой ответ:** карточка действий (последние 5 операций), таймер, кнопка
  «Остановить».
- **Автозапуск и сторож:** супервизор поднимает бота после падения, задача
  планировщика проверяет `/health` каждые 5 минут.

## Требования

| Требование | Зачем |
|---|---|
| Python 3.12 | бот |
| `aiogram` 3 и зависимости из `requirements.txt` | бот |
| DeepSeek Harness (`dsh` в PATH) | режим `agent` |
| ключ DeepSeek (`platform.deepseek.com`) | режим `fast` и агент |

## Установка

```powershell
$bot = 'C:\Users\<Имя>\...\dsh-plugin-mobile-ui\Telegram Bot'

uv venv "$bot\.venv" --python 3.12
uv pip install --python "$bot\.venv\Scripts\python.exe" -r "$bot\requirements.txt"

Copy-Item "$bot\config.example.json" "$bot\config.json"
# впишите botToken (из @BotFather) и deepseekApiKey
python "$bot\bot.py" --check
```

## Запуск

```powershell
Start-Process wscript.exe -ArgumentList "`"$bot\bot.vbs`""
```

Бот работает в скрытом окне. Панель состояния: <http://127.0.0.1:8099/>
(и `/health` для JSON).

## Автозапуск и сторож

| Звено | Что делает |
|---|---|
| `bot.vbs` + `start.ps1` | супервизор: запускает `bot.py` и поднимает его через 10 с после падения |
| `ensure-bot.vbs` + `ensure-bot.ps1` | сторож: проверяет `/health`; если бот молчит дольше 10 минут — убивает процесс |
| задача `DshTelegramBot` | запускает сторожа при входе и каждые 5 минут |
| `telegram-bot.vbs` в автозагрузке | поднимает супервизор при входе |

```powershell
$a = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument "`"$bot\ensure-bot.vbs`""
$t1 = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)
Register-ScheduledTask -TaskName 'DshTelegramBot' -Action $a -Trigger @($t1, $t2) -Force
```

## Кнопки и команды

Внизу чата: **Модель**, **Доступ**, **Новая сессия**, **Статус**, **Обновить**.
Печатать `/…` не нужно, но команды работают.

| Команда | Что делает |
|---|---|
| `/flash`, `/pro` | модель `deepseek-flash` / `deepseek-v4-pro` |
| `/low`, `/high`, `/max` | усилие рассуждений |
| `/full`, `/write`, `/read` | права агента |
| `/new` | новая сессия агента |
| `/status` | состояние бота, модель, усилие, доступ |
| `/cancel` | остановить текущий ход |
| `/update` | перезапуск бота |

## Права агента

| Пресет | Что разрешено |
|---|---|
| `read-only` | только чтение, изменения — через запрос |
| `workspace-write` | запись в рабочую папку; выход за неё — через запрос |
| `danger-full-access` | вся машина, без подтверждений (по умолчанию) |

Смена прав начинает новую сессию агента: пресет закрепляется за сессией при её
создании.

## Файлы

| Файл | Назначение |
|---|---|
| `bot.py` | точка входа: aiogram 3, команды, потоковая правка сообщения, панель |
| `backends.py` | агент DSH и прямой DeepSeek API |
| `formatting.py` | Markdown → MarkdownV2 |
| `approval_bridge.mjs` | мост approval-запросов DSH в Telegram |
| `config.json` | токен бота, ключ DeepSeek, модель/усилие/права, панель |
| `state.json` | владелец, сессии чатов, выбранные настройки (создаётся сам) |
| `start.ps1`, `bot.vbs` | супервизор в скрытом окне |
| `ensure-bot.ps1`, `ensure-bot.vbs` | сторож по `/health` |
| `logs/` | `bot.log`, `stdout.log`, `stderr.log`, `supervisor.log`, `watchdog.log` |

## Диагностика

| Симптом | Причина / что делать |
|---|---|
| `409 Conflict` | этого бота поллит кто-то ещё — остановите лишние процессы |
| бот молчит, `/health` не отвечает | процесс упал: сторож поднимет в течение 5 минут, лог — `logs/watchdog.log` |
| `EPERM … cordis.yml` | бот запущен venv-исполнителем, а не базовым python — см. `start.ps1` |
| `can't parse entities` | MarkdownV2 не принят; сообщение уйдёт простым текстом |
| бот молчит, `/status` отвечает | запрос ещё выполняется: дождитесь ответа или `/cancel` |

## Безопасность

- `config.json` содержит токен бота и ключ DeepSeek — **не коммитьте его**
  (он в `.gitignore`); в репозитории лежит обезличенный `config.example.json`.
- `danger-full-access` даёт боту доступ к компьютеру: для чужих чатов ставьте
  `workspace-write` или `read-only`.

## Лицензия

[MIT](LICENSE) © 2026 DEXWEBCODE
