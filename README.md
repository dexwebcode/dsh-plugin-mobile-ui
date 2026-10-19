# dsh-mobile-ui

> **Язык / Language:** [Русский](#dsh-plugin-mobile-ui-ru) · [English](#dsh-plugin-mobile-ui-en)


Плагин мобильного интерфейса для DeepSeek Harness. Встраивается в ваш локальный DSH, автоматически запускает веб-сервер и туннель ngrok и поддерживает React PWA, так что вы можете управлять DSH со своего телефона в любой сети — без домена, без VPS, с возможностью установки на домашний экран, с авторизацией и потоковой передачей через WebSocket.


Mobile UI plugin for DeepSeek Harness. Embeds into your local DSH, auto-starts a web server and ngrok tunnel, and serves a React PWA so you can control DSH from your phone on any network — no domain, no VPS, installable to home screen, with auth and WebSocket streaming

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## dsh-plugin-mobile-ui-ru

> [English version below ↓](#dsh-plugin-mobile-ui-en)

Самодостаточный мобильный доступ к DeepSeek Harness. Одна установка даёт:

- **защищённую паролем публичную ссылку** (ngrok, с запасным вариантом через Cloudflare Tunnel);
- **официальный веб-интерфейс DeepSeek Harness**, отдаваемый по этой ссылке;
- **адаптированный под телефон слой** поверх этого интерфейса.

Без домена, без VPS и без дополнительных плагинов — туннель, вход по паролю и мобильный слой вшиты внутрь пакета.

### Содержание

- [Что это делает](#что-это-делает)
- [Возможности](#возможности)
- [Требования](#требования)
- [Быстрый старт](#быстрый-старт)
- [Установка](#установка)
- [Настройка](#настройка)
- [Использование](#использование)
- [Примеры](#примеры)
- [Решение проблем](#решение-проблем)
- [Обновление и удаление](#обновление-и-удаление)
- [Безопасность](#безопасность)
- [FAQ](#faq)
- [Совместимость и ограничения](#совместимость-и-ограничения)
- [Лицензия](#лицензия)
- [Благодарности](#благодарности)

### Что это делает

DeepSeek Harness работает локально на вашем компьютере. Плагин открывает его веб-интерфейс для телефона и делает этот интерфейс удобным на маленьком сенсорном экране.

После установки вы открываете локальный веб-интерфейс, вставляете один токен, задаёте пароль — и получаете публичную HTTPS-ссылку и QR-код. Сканируете код на телефоне — открывается DeepSeek Harness, один раз спрашивается пароль, и дальше вы управляете локальным DSH из любой сети.

Три части поставляются вместе:

- **`dsh-mobile-ui/relay`** — вход по паролю и TLS перед петлевым веб-сервером.
- **`dsh-mobile-ui/tunnel`** — публикует relay через ngrok (или Cloudflare Tunnel).
- **`dsh-mobile-ui`** — мобильный слой поверх официального веб-интерфейса.

### Возможности

- **Публичный доступ без инфраструктуры.** Публичная HTTPS-ссылка создаётся автоматически, без домена и VPS.
- **Защита паролем.** Всё, что за ссылкой, требует заданный вами пароль (минимум 10 символов).
- **Подключение телефона по QR-коду.** Одноразовый 8-значный код (и QR, в который он зашит) подключает телефон; код действует сутки, а QR ведёт на публичный адрес ngrok.
- **Мобильный веб-интерфейс.** На узких экранах слой добавляет:
  - выдвижную панель со списком чатов, открываемую кнопкой в шапке;
  - кнопку «новый чат» в шапке;
  - живой бейдж статуса и полосу статистики, закреплённую сверху;
  - индикатор загрузки при переключении чата;
  - кнопку «вниз, к последнему сообщению», закреплённую над полем ввода;
  - обработку клавиатуры/видимой области и standalone-манифест PWA с иконками.
- **Без влияния на десктоп.** Мобильный слой включается только на узких экранах (≤1023 px); десктоп остаётся штатным.
- **Всё настраивается из интерфейса.** Токены ngrok, публичная ссылка, код подключения и пароль задаются в настройках, а не правкой файлов.
- **Несколько ngrok-аккаунтов.** Токены добавляются строками с именами: плагин помнит активный и сам переключается на следующий, когда у текущего кончается месячный трафик (`ERR_NGROK_725`). Переключить можно и вручную — тапом по строке в «Ссылки по аккаунтам»; активная строка обведена зелёным.
- **Счётчик трафика.** Расход виден полосой под логотипом в меню (зелёная → оранжевая → красная) и карточкой «Трафик ngrok» в настройках. Значение можно поправить вручную по кабинету ngrok — счётчик продолжит расти от него.
- **Меньше трафика.** Ассеты кэшируются `immutable`, relay пережимает их brotli (−15% к gzip), а service worker держит оболочку и ассеты в своём хранилище: повторный вход стоит около 7 КБ вместо 350.
- **Подсказка про VPN.** Если интерфейс не догрузился за 12 секунд или сетевой запрос упал, появляется объяснение: из РФ DeepSeek доступен только через VPN.
- **Раздел Mobile UI идёт первым** в навигации настроек.

### Требования

| Требование | Для чего | Примечания |
|---|---|---|
| DeepSeek Harness | Для всего | Должен быть установлен и запущен (`dsh web`). |
| Node.js `^22.19.0 || >=24` | Плагин | Указано в `engines` пакета. |
| `ngrok` бесплатный authtoken | Туннели ngrok | Туннель создает публичну ссылку. |
| Бинарник `cloudflared` | Туннели Cloudflare | Аккаунт не нужен; используется при `DSH_TUNNEL_PROVIDER=cloudflared`. |
| `pnpm` | Установка из CLI | `dsh plugin` передаёт управление пакетами в pnpm. |

Бинарник туннеля (`ngrok` или `cloudflared`) **обязателен** для публичного доступа. Положите его в `PATH` или в `~/.dsh/bin/` (на Windows, например, `~/.dsh/bin/ngrok.exe`).

### Быстрый старт

1. Установите плагин (см. [Установка](#установка)):

   ```bash
   dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui
   ```

2. Запустите DeepSeek Harness:

   ```bash
   dsh web
   ```

3. Откройте локальный веб-интерфейс и перейдите в **Настройки → Mobile UI**.

4. Вставьте authtoken ngrok в поле **Токен ngrok** и нажмите **Сохранить**. Токен бесплатный, берётся в [кабинете ngrok](https://dashboard.ngrok.com/get-started/your-authtoken). Аккаунтов можно добавить несколько: слева имя, справа токен, кнопка **+ Добавить токен** добавляет строку.

5. Подождите несколько секунд, пока в карточке **Туннель** не появится публичная ссылка (она появляется после подъёма туннеля).

6. В карточке **Пароль для входа** задайте пароль (не короче 10 символов). Сделайте это до того, как поделитесь ссылкой.

7. На телефоне отсканируйте QR из карточки **Подключение телефона** — или откройте публичную ссылку и введите показанный на экране код.

Мобильный доступ готов. Добавьте публичную ссылку в закладки: cookie входа живёт 30 дней.

> [!TIP]
> Если ngrok недоступен (например, блокировка `ERR_NGROK_9040`), переключитесь на Cloudflare: задайте `DSH_TUNNEL_PROVIDER=cloudflared` в окружении перед запуском DSH и убедитесь, что `cloudflared` есть в `PATH`.

### Установка

Плагин устанавливается в **профиль** DeepSeek Harness. Используйте любой из способов ниже.

#### Вариант A — из GitHub (рекомендуется)

```bash
dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui
```

В репозитории уже лежит собранный вывод (`lib/` и `vendor/relay.js`), поэтому установка из git работает сразу.

#### Вариант B — из локальной сборки

```bash
# в клонированном репозитории
npm run build      # или: npm pack  (pack запускает build через prepack)
npm pack
```

Получится `dsh-mobile-ui-<версия>.tgz`. Установите его с полным путём:

```bash
dsh plugin add "C:\путь\к\dsh-mobile-ui-3.6.0.tgz"
```

#### Вариант C — менеджер плагинов в веб-интерфейсе

Откройте DeepSeek Harness, перейдите в **Настройки → Плагины** и добавьте плагин там (репозиторий GitHub или собранный tarball).

> [!NOTE]
> `dsh plugin …` — менеджер пакетов профилей DeepSeek Harness; он передаёт команды в `pnpm` в каталоге активного профиля, поэтому `pnpm` должен быть в `PATH`.

#### Проверка установки

После установки и запуска `dsh web` откройте **Настройки**. Должен появиться раздел **Mobile UI** — он стоит первым в списке. Если раздела нет — плагин не загрузился в запущенный профиль: проверьте имя профиля и менеджер плагинов.

### Настройка

Все повседневные настройки находятся в **Настройки → Mobile UI**. Конфигурация не правится вручную в файлах; два файла состояния ниже плагин пишет сам.

| Параметр | Описание | По умолчанию | Обязателен |
|---|---|---|---|
| `ngrokAuthtoken` | Пул authtoken ngrok через запятую; активный синхронизируется в окружение `NGROK_AUTHTOKEN` процесса за ~2 с | пусто | Только для ngrok |
| `ngrokAuthtokenNames` | Подписи к токенам в том же порядке (только для интерфейса; пустое место даёт «Аккаунт N») | пусто | Нет |
| `ngrokMonthlyLimitBytes` | Месячный лимит трафика одного аккаунта в байтах — по нему считается остаток и рисуется полоса | `1073741824` (1 ГиБ) | Нет |
| `DSH_RELAY_BIND` | Адрес, на котором слушает relay | `0.0.0.0` | Нет |
| `DSH_RELAY_PORT` | Порт relay | `3443` | Нет |
| `DSH_RELAY_TLS` | Режим TLS relay | `self-signed` | Нет |
| `DSH_RELAY_DISABLE` | Значение `1` отключает relay | — | Нет |
| `DSH_TUNNEL_PROVIDER` | Провайдер туннеля: `ngrok` или `cloudflared` | `ngrok` | Нет |

Файлы, которые создаёт плагин:

| Файл | Назначение |
|---|---|
| `~/.dsh/tunnel-url.txt` | Публичная ссылка, которую пишет туннель после подъёма. |
| `~/.dsh/relay/state.json` | Состояние relay (хранит признак заданного пароля). |
| `~/.dsh/relay/` | Каталог состояния relay. |
| `~/.dsh/ngrok-accounts.json` | Номер активного аккаунта в пуле (чтобы после перезапуска не возвращаться на исчерпанный). |
| `~/.dsh/ngrok-urls.json` | Последний известный публичный адрес каждого аккаунта — по нему строится список ссылок. |
| `~/.dsh/ngrok-usage.json` | Израсходованные байты по аккаунтам и месяцам плюс ручная поправка по кабинету. |
| `~/.dsh/bin/` | Где туннель ищет бинарник провайдера (`ngrok`/`cloudflared`). |

> [!IMPORTANT]
> Настройки (включая токен ngrok и пароль) сохраняются **только с локального компьютера**, но не через публичную ссылку. Если форма настроек открыта с телефона, она доступна только для чтения.

> [!WARNING]
> Никогда не публикуйте и не коммитьте authtoken ngrok или пароль. Токен хранится как volatile-настройка DSH на вашем компьютере, а не в репозитории.

### Использование

#### Повседневный сценарий

1. Запустите DeepSeek Harness: `dsh web`.
2. Один раз откройте локальный интерфейс и убедитесь, что в **Настройки → Mobile UI** есть публичная ссылка.
3. На телефоне откройте сохранённую в закладках публичную ссылку и войдите по паролю.
4. Работайте с DeepSeek Harness с телефона: откройте панель чатов кнопкой в шапке, переключайте чаты, отправляйте запросы.

#### Как убедиться, что всё работает

- В карточке **Туннель** показана непустая ссылка и «Пароль задан — телефон можно подключать».
- В `~/.dsh/tunnel-url.txt` лежит ссылка.
- В логе `dsh web` есть `public URL: https://…` и `relay answers on the public URL (200)`.

#### Подключение ещё одного телефона

Откройте **Настройки → Mobile UI → Подключение телефона** и отсканируйте QR или введите код вручную. Код одноразовый и живёт сутки; кнопка **Новый код** выпускает новый сразу. В QR зашит **публичный адрес ngrok**, поэтому сканировать его можно с любого устройства.

#### Несколько ngrok-аккаунтов

Бесплатный ngrok даёт **1 ГиБ трафика в месяц на аккаунт**. Плагин держит пул аккаунтов:

- в каждой строке сначала **имя**, потом токен; **+ Добавить токен** добавляет строку;
- активный аккаунт помечен **зелёной обводкой и галочкой** слева;
- когда у активного кончается трафик (`ERR_NGROK_725`), плагин сам переключается на следующий и перезапускает агент;
- переключить вручную — **тап по строке** в «Ссылки по аккаунтам». Значок копирования рядом копирует адрес, не переключая аккаунт;
- у каждого аккаунта свой постоянный домен, поэтому при переключении **меняется публичный адрес** и QR.

#### Трафик и лимиты

- Полоса под логотипом в меню показывает **остаток**: зелёная, пока больше половины, оранжевая до 20%, красная ниже.
- Карточка **Трафик ngrok** в настройках показывает расход, лимит и имя аккаунта; карандаш открывает ручной ввод значения из [кабинета ngrok](https://dashboard.ngrok.com/usage), после чего счётчик растёт уже от него.
- Экономия: ассеты кэшируются навсегда, relay пережимает их brotli, service worker держит оболочку и ассеты у себя. Повторный вход с телефона стоит ~7 КБ вместо ~350 КБ.
- Точные цифры по аккаунту всегда в кабинете: плагин не видит байты самого ngrok (страница-предупреждение, страницы ошибок) и трафик других проектов на том же аккаунте — для этого и нужна ручная поправка.

#### Смена пароля

**Настройки → Mobile UI → Пароль для входа** — введите новый пароль дважды (минимум 10 символов). Меняется пароль, по которому телефон входит.

#### Остановка публичного доступа

Туннель запускается отдельным процессом и намеренно переживает перезапуски DSH (публичное имя переиспользуется). Чтобы полностью прекратить публичный доступ:

- удалите или отключите плагин (см. [Обновление и удаление](#обновление-и-удаление)), либо
- завершите процесс `ngrok` / `cloudflared`.

### Примеры

#### Пример 1 — первое подключение телефона

1. `dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui`
2. `dsh web`
3. Настройки → Mobile UI → вставьте authtoken ngrok → Сохранить.
4. Задайте пароль (≥ 10 символов).
5. Отсканируйте QR камерой телефона.
6. Ожидаемый результат: DeepSeek Harness открывается на телефоне за паролем, доступна мобильная панель чатов.

#### Пример 2 — Cloudflare вместо ngrok

1. Установите `cloudflared` так, чтобы он был в `PATH` или в `~/.dsh/bin/`.
2. Запустите DSH с `DSH_TUNNEL_PROVIDER=cloudflared dsh web` (или задайте переменную в шелле заранее).
3. Ожидаемый результат: в карточке «Туннель» появится ссылка вида `https://*.trycloudflare.com`; телефон подключается так же.

#### Пример 3 — офлайн-установка из tarball

1. В репозитории: `npm run build && npm pack`.
2. `dsh plugin add "C:\путь\к\dsh-mobile-ui-3.6.0.tgz"`.
3. Ожидаемый результат: плагин установлен, разделы настроек появляются после перезапуска `dsh web`.

### Решение проблем

| Проблема | Возможная причина | Решение |
|---|---|---|
| Публичной ссылки нет / «Токен ещё не задан…» | Нет authtoken ngrok | Задайте токен в Настройки → Mobile UI и нажмите «Сохранить». |
| ngrok завершается с `ERR_NGROK_9040` | ngrok блокирует адреса из России | Переключитесь на Cloudflare: `DSH_TUNNEL_PROVIDER=cloudflared` и установите `cloudflared`. |
| На телефоне `ERR_NGROK_725` | У активного аккаунта кончился месячный трафик | Плагин переключится сам, если добавлен второй токен; иначе добавьте аккаунт или дождитесь 1-го числа. |
| «все ngrok-аккаунты упёрлись в лимит» | Исчерпаны все токены пула | Добавьте новый аккаунт ngrok; плагин проверяет лимит раз в минуту и ждёт 30 минут после неудачного круга. |
| Полоса трафика врёт | Плагин не видит байты самого ngrok и трафик других проектов | Нажмите карандаш в карточке «Трафик ngrok» и введите значение из кабинета ngrok. |
| «Relay не отвечает — проверьте, что он запущен.» | Relay не запущен | Убедитесь, что `dsh web` работает; проверьте порт relay (`DSH_RELAY_PORT`). |
| Подключение возвращает `relay-unavailable` (503) | Relay недоступен из маршрута хоста | Перезапустите DSH; проверьте, что relay поднят. |
| Пароль отклонён | Меньше 10 символов или поля не совпадают | Используйте ≥ 10 символов и совпадающие поля. |
| «Сменить пароль можно только с этой машины.» | Смена пароля выполнена удалённо | Меняйте пароль из локального веб-интерфейса. |
| Настройки не сохраняются с телефона | Настройки только с хоста | Откройте локальный интерфейс на компьютере с DSH. |
| `dsh: pnpm was not found` | Нет pnpm | Установите pnpm и добавьте в `PATH`. |
| Плагин не обнаружен | Установлен в другой профиль | Проверьте активный профиль и менеджер плагинов. |
| Туннель не стартует | Нет бинарника провайдера | Положите `ngrok`/`cloudflared` в `PATH` или `~/.dsh/bin/`. |
| Плашка «работает только с VPN» | DeepSeek не отдал данные из РФ | Включите VPN; плашка появляется, если интерфейс не догрузился за 12 с. |

### Обновление и удаление

#### Обновление

Повторите установку новой версии:

```bash
dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui
# или конкретный/новый tarball
dsh plugin add "C:\путь\к\dsh-mobile-ui-<новая-версия>.tgz"
```

Собранный вывод лежит в репозитории, поэтому установка из git сразу берёт актуальное состояние.

#### Удаление

```bash
dsh plugin remove dsh-mobile-ui
```

или удалите в **Настройки → Плагины**.

> [!WARNING]
> Удаление плагина удаляет и вшитые relay и туннель, поэтому публичная ссылка перестаёт работать. Состояние пароля в `~/.dsh/relay/` и файл `~/.dsh/tunnel-url.txt` **не** удаляются автоматически; удалите их вручную, если они больше не нужны. Ваши сессии и рабочее пространство — собственные данные DSH, они не затрагиваются.

### Безопасность

- Всё за публичной ссылкой закрыто **паролем** (минимум 10 символов). Задайте его до того, как поделитесь ссылкой.
- Relay использует **самоподписанный сертификат** на петлевом интерфейсе; публичный TLS терминирует ngrok/Cloudflare, поэтому телефон общается с провайдером по HTTPS.
- **Код подключения одноразовый** и живёт сутки; в QR зашиты публичный адрес ngrok, код и отпечаток сертификата.
- Relay **ограничивает частоту** входа (6000 запросов/мин), допускает 20 неудачных попыток и затем блокирует на 5 минут; сессия после входа живёт 30 дней.
- **Настройки нельзя менять удалённо**: токен и пароль записываются только с компьютера, на котором работает DSH.

> [!WARNING]
> Публичная ссылка сама по себе — секрет: у кого есть ссылка и пароль, тот управляет вашим DeepSeek Harness. Не публикуйте ссылку открыто и используйте надёжный пароль.

### FAQ

**Нужен ли домен или VPS?** Нет. Публичную ссылку даёт туннель.

**Нужно ли ставить другие плагины?** Нет. Relay и туннель вшиты внутрь пакета.

**ngrok или Cloudflare?** По умолчанию ngrok, нужен бесплатный authtoken. Cloudflare (`DSH_TUNNEL_PROVIDER=cloudflared`) — если ngrok заблокирован или аккаунт не нужен.

**Сколько телефонов можно подключить?** Сколько угодно: вход по паролю, сессия живёт 30 дней, все устройства за одним туннелем.

**Что будет, когда кончится трафик ngrok?** Если в пуле есть второй аккаунт, плагин сам переключится на него и перезапустит туннель; адрес и QR при этом сменятся. Если аккаунт один — ngrok покажет `ERR_NGROK_725` до 1-го числа.

**Можно ли не держать телефон в фоне?** Да, сессия входа живёт 30 дней, а ассеты кэшируются — повторный вход почти ничего не качает.

**Это меняет десктопный интерфейс?** Нет. Мобильный слой включается только на узких экранах (≤1023 px).

**Пароль обязателен?** Формально нет, но без него любой, кто знает ссылку, откроет DeepSeek Harness. Всегда задавайте пароль.

**Что делать, если код подключения истёк?** Откройте Настройки → Mobile UI и отсканируйте текущий QR/код; если он только что истёк — нажмите «Новый код».

### Совместимость и ограничения

- **Node.js:** `^22.19.0 || >=24` (`engines` пакета).
- **Бинарник туннеля:** обязателен, ищется в `~/.dsh/bin` или `PATH`; плагин его не скачивает.
- **ngrok** блокирует адреса из России (`ERR_NGROK_9040`); там используйте `cloudflared`.
- **Лимит ngrok:** 1 ГиБ трафика в месяц на бесплатном аккаунте. Плагин показывает расход и переключается на следующий аккаунт из пула, но саму квоту не увеличивает.
- Мобильный слой рассчитан на узкие экраны и не меняет десктопную раскладку.

> [!NOTE]
> Имя `dsh-mobile-ui` в npm сейчас указывает на старый пакет (`0.2.11`, только мобильный слой). Чтобы установить **эту** версию (с туннелем, входом и подключением), устанавливайте из GitHub или из собранного tarball, как описано выше.

### Лицензия

[MIT](LICENSE) © 2026 DEXWEBCODE

### Благодарности

Спонсор и идейный вдохновитель проекта — [RekXvill](https://github.com/RekXvill).

---

## dsh-plugin-mobile-ui-en

> [Русская версия выше ↑](#dsh-plugin-mobile-ui-ru)

Self-contained mobile access for DeepSeek Harness. One install gives you:

- a **password-protected public URL** (ngrok, with Cloudflare Tunnel as a fallback);
- the **official DeepSeek Harness web UI** served through it;
- a **phone-optimized layer** over that UI.

No domain, no VPS, no other plugins required — the tunnel, the sign-in gate and the mobile layer are all vendored inside this package.

### Table of contents

- [What it does](#what-it-does)
- [Features](#features)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)
- [Updating and uninstalling](#updating-and-uninstalling)
- [Security](#security)
- [Frequently asked questions](#frequently-asked-questions)
- [Compatibility and limitations](#compatibility-and-limitations)
- [License](#license)
- [Acknowledgements](#acknowledgements)

### What it does

DeepSeek Harness runs locally. This plugin exposes its web interface to your phone and makes that interface comfortable to use on a small touch screen.

Concretely, after installation you open the local web UI, paste one token, set a password, and get a public HTTPS link plus a QR code. Scanning that code on the phone opens DeepSeek Harness, asks for the password once, and from then on you can drive your local DSH from anywhere.

The three pieces are shipped together:

- **`dsh-mobile-ui/relay`** — password sign-in and TLS in front of the loopback web server.
- **`dsh-mobile-ui/tunnel`** — publishes the relay through ngrok (or Cloudflare Tunnel).
- **`dsh-mobile-ui`** — the mobile layer over the official web UI.

### Features

- **Public access without infrastructure.** A public HTTPS URL is created automatically; no domain or VPS.
- **Password protection.** Anything behind the URL requires the password you set (minimum 10 characters).
- **Phone pairing by QR code.** A one-time 8-digit code (with a QR that embeds it) connects the phone; the code is valid for 24 hours and the QR points at the public ngrok URL.
- **Mobile web UI.** On narrow screens the layer adds:
  - a drawer sidebar with the session list, opened from a button in the header;
  - a "new chat" button in the header;
  - the live status badge and a stats strip pinned to the top;
  - a loading indicator while a chat is switching;
  - a "back to bottom" button pinned above the input field;
  - keyboard/viewport handling and a standalone PWA manifest with app icons.
- **Zero desktop impact.** The mobile layer only activates on narrow viewports (≤1023 px); the desktop UI stays native.
- **Everything managed from the UI.** The ngrok tokens, the public link, the pairing code and the password are configured in the settings, not by hand-editing files.
- **Several ngrok accounts.** Tokens are added as named rows: the plugin remembers the active one and switches to the next by itself when the current account runs out of monthly traffic (`ERR_NGROK_725`). You can also switch manually by tapping a row in "Links per account"; the active row is outlined in green.
- **Traffic counter.** Usage is shown as a bar under the logo in the menu (green → orange → red) and in the "Traffic ngrok" card in settings. The number can be corrected by hand from the ngrok dashboard — afterwards the counter keeps growing from your value.
- **Less traffic.** Assets are cached as `immutable`, the relay recompresses them with brotli (−15% versus gzip), and a service worker keeps the shell and assets in its own storage: a repeat visit costs about 7 KB instead of 350.
- **VPN hint.** If the UI does not finish loading within 12 seconds, or a network request fails, the plugin explains that DeepSeek is reachable only through a VPN from Russia.
- **The Mobile UI section comes first** in the settings navigation.

### Requirements

| Requirement | Needed for | Notes |
|---|---|---|
| DeepSeek Harness | Everything | Must be installed and running (`dsh web`). |
| Node.js `^22.19.0 || >=24` | The plugin | Declared in the package `engines`. |
| `ngrok` binary + free authtoken | ngrok tunnels | The tunnel resolves the binary from `~/.dsh/bin` or `PATH`; it does not download it. |
| `cloudflared` binary | Cloudflare tunnels | No account needed; used when `DSH_TUNNEL_PROVIDER=cloudflared`. |
| `pnpm` | CLI installs | `dsh plugin` forwards package management to pnpm. |

The tunnel binary (`ngrok` or `cloudflared`) is **required** for public access. Put it on `PATH` or in `~/.dsh/bin/` (for example `~/.dsh/bin/ngrok.exe` on Windows).

### Quick start

1. Install the plugin (see [Installation](#installation)):

   ```bash
   dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui
   ```

2. Start DeepSeek Harness:

   ```bash
   dsh web
   ```

3. Open the local web UI and go to **Settings → Mobile UI**.

4. Paste your ngrok authtoken into the **Токен ngrok / ngrok token** field and press **Save**. The token is free and taken from the [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken). You can add several accounts: a name on the left, the token on the right, and **+ Добавить токен / Add token** adds another row.

5. Wait a few seconds until the **Tunnel** card shows a public URL (the link appears once the tunnel is up).

6. In the **Пароль для входа / Password** card, set a password (at least 10 characters). Do this before sharing the link.

7. On the phone, scan the QR in the **Подключение телефона / Phone pairing** card — or open the public URL and enter the one-time code shown on screen.

You now have working mobile access. Bookmark the public URL; the sign-in cookie lasts 30 days.

> [!TIP]
> If ngrok is unavailable (for example the `ERR_NGROK_9040` block), switch to Cloudflare: set `DSH_TUNNEL_PROVIDER=cloudflared` in the environment before starting DSH, and make sure `cloudflared` is on `PATH`.

### Installation

The plugin is a DeepSeek Harness plugin installed into a **profile**. Use one of the methods below.

#### Option A — from GitHub (recommended)

```bash
dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui
```

The repository ships its built output (`lib/` and `vendor/relay.js`), so a git install works directly.

#### Option B — from a local build

```bash
# in the cloned repository
npm run build      # or: npm pack  (pack runs build via the prepack script)
npm pack
```

This produces `dsh-mobile-ui-<version>.tgz`. Install it with the full path:

```bash
dsh plugin add "C:\path\to\dsh-mobile-ui-3.6.0.tgz"
```

#### Option C — the plugin manager in the web UI

Open DeepSeek Harness, go to **Settings → Plugins** and add the plugin there (the GitHub repository or a built tarball).

> [!NOTE]
> `dsh plugin …` is DeepSeek Harness's package manager for profiles; it forwards to `pnpm` in the active profile directory, so `pnpm` must be on `PATH`.

#### Verifying the install

After installing and starting `dsh web`, open **Settings**. You should see a **Mobile UI** section at the top of the list. If the section is missing, the plugin was not loaded into the profile that is currently running — re-check the profile name and the plugin manager.

### Configuration

All day-to-day settings live in **Settings → Mobile UI**. Configuration is not hand-edited in files; the two state files below are written by the plugin itself.

| Parameter | Description | Default | Required |
|---|---|---|---|
| `ngrokAuthtoken` | ngrok authtoken pool, comma-separated; the active one is synced to the `NGROK_AUTHTOKEN` environment of the running process within ~2 s | empty | Only for ngrok |
| `ngrokAuthtokenNames` | Labels for the tokens in the same order (UI only; an empty slot becomes "Аккаунт N") | empty | No |
| `ngrokMonthlyLimitBytes` | Monthly traffic limit of one account in bytes — drives the remaining value and the bar | `1073741824` (1 GiB) | No |
| `DSH_RELAY_BIND` | Relay bind address | `0.0.0.0` | No |
| `DSH_RELAY_PORT` | Relay port | `3443` | No |
| `DSH_RELAY_TLS` | Relay TLS mode | `self-signed` | No |
| `DSH_RELAY_DISABLE` | Set to `1` to disable the relay | — | No |
| `DSH_TUNNEL_PROVIDER` | Tunnel provider: `ngrok` or `cloudflared` | `ngrok` | No |

Files created by the plugin:

| File | Purpose |
|---|---|
| `~/.dsh/tunnel-url.txt` | The public URL, written by the tunnel once it is up. |
| `~/.dsh/relay/state.json` | Relay state (records whether a password is set). |
| `~/.dsh/relay/` | Relay state directory. |
| `~/.dsh/ngrok-accounts.json` | Index of the active account in the pool (so a restart does not fall back to an exhausted one). |
| `~/.dsh/ngrok-urls.json` | Last known public URL of each account — used to build the links list. |
| `~/.dsh/ngrok-usage.json` | Bytes used per account and month, plus the manual correction from the dashboard. |
| `~/.dsh/bin/` | Where the tunnel looks for the provider binary (`ngrok`/`cloudflared`). |

> [!IMPORTANT]
> Settings (including the ngrok token and the password) can only be **saved from the local machine**, not through the public URL. If the settings form is opened from the phone, it is read-only.

> [!WARNING]
> Never commit or share your ngrok authtoken or password. The authtoken is stored as a volatile DSH setting on your machine, not in the repository.

### Usage

#### Everyday flow

1. Start DeepSeek Harness: `dsh web`.
2. Open the local UI once, confirm the public URL is present in **Settings → Mobile UI**.
3. On the phone, open the bookmarked public URL and sign in with the password.
4. Use DeepSeek Harness from the phone: open the session drawer from the header button, switch chats, send prompts.

#### Checking that it works

- The **Tunnel** card in settings shows a non-empty URL and "Пароль задан — телефон можно подключать."
- `~/.dsh/tunnel-url.txt` contains the URL.
- The `dsh web` log prints `public URL: https://…` and `relay answers on the public URL (200)`.

#### Pairing another phone

Open **Settings → Mobile UI → Подключение телефона** and scan the QR, or enter the code manually. The code is one-time and valid for 24 hours; press **Новый код / New code** to issue a new one immediately. The QR carries the **public ngrok URL**, so it works from any device.

#### Several ngrok accounts

Free ngrok gives **1 GiB of traffic per month per account**. The plugin keeps a pool:

- each row is a **name** followed by a token; **+ Добавить токен / Add token** adds a row;
- the active account is marked with a **green outline and a checkmark** on the left;
- when the active account runs out of traffic (`ERR_NGROK_725`), the plugin switches to the next one and restarts the agent;
- switch manually by **tapping a row** in "Links per account". The copy icon next to it copies the URL without switching accounts;
- every account has its own permanent domain, so switching **changes the public URL** and the QR.

#### Traffic and limits

- The bar under the logo in the menu shows the **remaining** share: green while more than half is left, orange down to 20%, red below.
- The **Traffic ngrok** card in settings shows usage, the limit and the account name; the pencil opens a manual value taken from the [ngrok dashboard](https://dashboard.ngrok.com/usage), and the counter keeps growing from it.
- Savings: assets are cached forever, the relay recompresses them with brotli, and the service worker keeps the shell and assets itself. A repeat visit from the phone costs about 7 KB instead of about 350 KB.
- Exact per-account numbers always live in the dashboard: the plugin cannot see ngrok's own bytes (the browser warning page, error pages) or other projects' traffic on the same account — that is what the manual correction is for.

#### Changing the password

**Settings → Mobile UI → Пароль для входа** — enter the new password twice (minimum 10 characters). This changes the password that the phone uses to sign in.

#### Stopping public access

The tunnel process is detached and kept alive across DSH restarts by design (the public name is reused). To stop public access entirely:

- remove or disable the plugin (see [Updating and uninstalling](#updating-and-uninstalling)), or
- terminate the `ngrok` / `cloudflared` process.

### Examples

#### Example 1 — connect your phone for the first time

1. `dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui`
2. `dsh web`
3. Settings → Mobile UI → paste ngrok authtoken → Save.
4. Set a password (≥ 10 characters).
5. Scan the QR with the phone camera.
6. Expected result: DeepSeek Harness opens on the phone behind the password gate, and the mobile drawer is available.

#### Example 2 — use Cloudflare instead of ngrok

1. Install `cloudflared` so it is on `PATH` or in `~/.dsh/bin/`.
2. Start DSH with `DSH_TUNNEL_PROVIDER=cloudflared dsh web` (or set the variable in your shell first).
3. Expected result: a `https://*.trycloudflare.com` URL appears in the Tunnel card; the phone connects the same way.

#### Example 3 — offline install from a tarball

1. `npm run build && npm pack` in the repository.
2. `dsh plugin add "C:\path\to\dsh-mobile-ui-3.6.0.tgz"`.
3. Expected result: the plugin is installed and the settings sections appear after restarting `dsh web`.

### Troubleshooting

| Problem | Possible cause | Solution |
|---|---|---|
| No public link appears / "Токен ещё не задан…" | No ngrok authtoken | Set the token in Settings → Mobile UI and press Save. |
| ngrok exits with `ERR_NGROK_9040` | ngrok blocks addresses from Russia | Switch to Cloudflare: `DSH_TUNNEL_PROVIDER=cloudflared` and install `cloudflared`. |
| The phone shows `ERR_NGROK_725` | The active account used up its monthly traffic | The plugin switches by itself if a second token is added; otherwise add an account or wait for the 1st of the month. |
| "все ngrok-аккаунты упёрлись в лимит" | Every token in the pool is exhausted | Add a new ngrok account; the plugin checks the limit once a minute and backs off for 30 minutes after a failed round. |
| The traffic bar is off | The plugin cannot see ngrok's own bytes or other projects' traffic | Press the pencil in the "Traffic ngrok" card and enter the value from the ngrok dashboard. |
| "Relay не отвечает — проверьте, что он запущен." | The relay is not running | Make sure `dsh web` is running; check the relay port (`DSH_RELAY_PORT`). |
| Pairing returns `relay-unavailable` (503) | Relay unreachable from the host route | Restart DSH; verify the relay is up. |
| Password rejected | Fewer than 10 characters, or fields differ | Use ≥ 10 characters and match both fields. |
| "Сменить пароль можно только с этой машины." | Password change attempted remotely | Change the password from the local web UI. |
| Settings won't save from the phone | Settings are host-only | Open the local UI on the machine running DSH. |
| `dsh: pnpm was not found` | pnpm missing | Install pnpm and put it on `PATH`. |
| Plugin not detected | Installed into a different profile | Check the active profile and the plugin manager. |
| Tunnel never starts | Provider binary missing | Put `ngrok`/`cloudflared` on `PATH` or in `~/.dsh/bin/`. |
| The "works only over VPN" notice appears | DeepSeek did not deliver data from Russia | Turn on a VPN; the notice appears when the UI has not loaded within 12 s. |

### Updating and uninstalling

#### Update

Re-run the install for the new version:

```bash
dsh plugin add github:dexwebcode/dsh-plugin-mobile-ui
# or a pinned/new tarball
dsh plugin add "C:\path\to\dsh-mobile-ui-<new-version>.tgz"
```

The built output is committed, so a git install picks up the latest state.

#### Uninstall

```bash
dsh plugin remove dsh-mobile-ui
```

or remove it in **Settings → Plugins**.

> [!WARNING]
> Removing the plugin also removes the bundled relay and tunnel, so the public URL stops working. The password state in `~/.dsh/relay/` and `~/.dsh/tunnel-url.txt` are **not** deleted automatically; delete them manually if you want them gone. Your sessions and workspace are DSH's own data and are unaffected.

### Security

- Everything behind the public URL is behind a **password** (minimum 10 characters). Set it before sharing the link.
- The relay uses a **self-signed certificate** on the loopback interface; public TLS is terminated by ngrok/Cloudflare, so the phone talks to the provider over HTTPS.
- The **pairing code is one-time** and valid for 24 hours; the QR embeds the public ngrok URL, the code and the certificate fingerprint.
- The relay **rate-limits** sign-in (6000 requests/minute), allows 20 failed attempts and then locks out for 5 minutes; a signed-in session lasts 30 days.
- **Settings cannot be changed remotely**: the token and password can only be written from the machine running DSH.

> [!WARNING]
> The public URL itself is effectively a secret: anyone who has both the URL and the password can use your DeepSeek Harness. Do not post the URL publicly, and use a strong password.

### Frequently asked questions

**Do I need a domain or a VPS?** No. The tunnel provides the public URL.

**Do I need to install other plugins?** No. The relay and the tunnel are vendored inside this package.

**ngrok or Cloudflare?** ngrok is the default and needs a free authtoken. Use Cloudflare (`DSH_TUNNEL_PROVIDER=cloudflared`) if ngrok is blocked or you prefer no account.

**How many phones can connect?** As many as you like: sign-in is password-based, a session lasts 30 days, and all devices share one tunnel.

**What happens when the ngrok traffic runs out?** If the pool has a second account, the plugin switches to it and restarts the tunnel; the URL and the QR change accordingly. With a single account, ngrok shows `ERR_NGROK_725` until the 1st of the month.

**Can I stop keeping the phone in the foreground?** Yes — the sign-in session lasts 30 days and assets are cached, so a repeat visit costs almost nothing.

**Does this change the desktop UI?** No. The mobile layer only activates on narrow viewports (≤1023 px).

**Is the password mandatory?** Technically no, but without it anyone who knows the link can open DeepSeek Harness. Always set it.

**How do I reconnect after the pairing code expires?** Open Settings → Mobile UI and scan the current QR or code; press "New code" if it has just expired.

### Compatibility and limitations

- **Node.js:** `^22.19.0 || >=24` (package `engines`).
- **Tunnel binary:** required, resolved from `~/.dsh/bin` or `PATH`; the plugin does not download it.
- **ngrok** blocks addresses from Russia (`ERR_NGROK_9040`); use `cloudflared` there.
- **ngrok limit:** 1 GiB of traffic per month on a free account. The plugin shows usage and switches to the next account in the pool, but it cannot raise the quota itself.
- The mobile layer targets narrow viewports; it does not alter the desktop layout.

> [!NOTE]
> The npm name `dsh-mobile-ui` currently points to an older package (`0.2.11`, mobile layer only). To install **this** version (with the tunnel, sign-in and pairing), install from GitHub or a built tarball as described above.

### License

[MIT](LICENSE) © 2026 DEXWEBCODE

### Acknowledgements

Sponsored and inspired by [RekXvill](https://github.com/RekXvill).
