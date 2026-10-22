"""bot.py — Telegram-бот к DeepSeek на aiogram 3.

Два «мозга» (переключаются на чат командами ``/agent`` и ``/fast``):

* **agent** — твой DSH-агент: ``dsh headless --json`` в отдельном процессе, с
  инструментами, рабочей папкой и сессиями;
* **fast** — прямой DeepSeek API (``deepseek-flash``), без инструментов.

Модель и усилие переключаются на чат командами ``/flash``, ``/pro`` и
``/low``, ``/high``, ``/max``; выбор хранится в ``state.json`` и применяется к
следующим запросам. Для агента пара «модель-усилие» передаётся в ``dsh``
временным ``--patch`` (см. :mod:`backends`), для быстрого режима — полями
запроса к API.

Ответы приходят в MarkdownV2: модель отвечает обычным Markdown, а
:mod:`formatting` переводит его в разметку Telegram с полным экранированием.
Если Telegram всё равно откажется разбирать разметку, кусок уходит простым
текстом — сообщение не теряется.

Запуск:
    python bot.py              боевой режим (long polling)
    python bot.py --check      проверить конфиг и токен
    python bot.py --selftest   прогнать оба «мозга» по одному разу
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import logging
import os
import secrets
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Optional

import aiohttp
from aiogram import Bot, Dispatcher, F, Router
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ParseMode
from aiogram.exceptions import TelegramAPIError, TelegramBadRequest, TelegramNetworkError, TelegramRetryAfter
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    CallbackQuery,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    Message,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
)
from aiohttp import web

from backends import (
    DEFAULT_PERMISSION,
    EFFORTS,
    MODEL_FLASH,
    MODEL_PRO,
    MODELS,
    PERMISSIONS,
    AgentEvent,
    AgentRunner,
    normalize_permission,
    resolve_dsh_bin,
    run_chat,
)
from formatting import escape_code, md_to_v2, split_for_telegram

BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = BASE_DIR / "config.json"
STATE_PATH = BASE_DIR / "state.json"
LOG_DIR = BASE_DIR / "logs"
LOG_PATH = LOG_DIR / "bot.log"
PATCH_DIR = BASE_DIR / ".runtime"
#: Файл-замок: одна копия бота на токен, иначе Telegram отвечает 409 Conflict.
LOCK_PATH = PATCH_DIR / "bot.lock"
MAX_LOG_BYTES = 4 * 1024 * 1024
STREAM_LIMIT = 3800
#: Как часто перерисовывать сообщение: таймер, текст и кнопка «Остановить».
REFRESH_INTERVAL = 5.0

#: Текст заглушки, пока агент думает.
THINKING_TEXT = "DeepSeek Thinking"

#: Сколько секунд бот ждёт перед перезапуском — чтобы успеть предупредить в чате.
RESTART_DELAY_SEC = 10

#: Пауза после «Перезапускаю…», когда ждать ходы нельзя (флаг ставит сам агент):
#: только на доставку уже готовых сообщений.
RESTART_GRACE_SEC = 5

#: Сколько последних операций агента держать в карточке кода.
CARD_OPS = 5

#: Человеческие названия прав: показываются в статусе и в ответах команд.
PERMISSION_TITLES = {
    "read-only": "только чтение",
    "workspace-write": "запись в рабочую папку",
    "danger-full-access": "полный доступ (full access)",
}

#: Значок прав в строке настроек.
PERMISSION_ICONS = {
    "read-only": "👀",
    "workspace-write": "✍️",
    "danger-full-access": "🔓",
}

#: Что именно разрешают права — для списка в /permission.
PERMISSION_HINTS = {
    "read-only": "читать можно, менять и запускать нельзя",
    "workspace-write": "менять файлы только в рабочей папке",
    "danger-full-access": "любые файлы и команды, без подтверждений",
}

MODEL_TITLES: dict[str, str] = {
    MODEL_FLASH: "DeepSeek Flash",
    MODEL_PRO: "DeepSeek Pro",
}

#: Нижняя клавиатура: ряды кнопок (подпись, действие). Действие — либо
#: команда ``/…``, либо ``ui:…`` — открыть inline-панель.
#:
#: Три ряда: 2 + 1 широкая + 2 кнопки. Клавиатура постоянная
#: (``is_persistent``), поэтому печатать «/…» не нужно вовсе.
MENU_ROWS: tuple[tuple[tuple[str, str], ...], ...] = (
    (("Модель", "ui:model"), ("Доступ", "ui:access")),
    (("Новая сессия", "/new"),),
    (("Статус", "/status"), ("Обновить", "/update")),
)

#: Подпись кнопки → команда или inline-панель.
MENU_ACTIONS: dict[str, str] = {
    label: action for row in MENU_ROWS for label, action in row
}

#: Кнопки прошлой, шестирядной клавиатуры. Пока клиент не заменил клавиатуру,
#: их нажатия должны работать, а не уходить в чат как обычный текст.
LEGACY_MENU_ACTIONS: dict[str, str] = {
    "☰ Меню": "/menu",
    "Flash": "/flash",
    "Pro": "/pro",
    "Low": "/low",
    "High": "/high",
    "Max": "/max",
    "🔓 Полный": "/full",
    "✍️ Запись": "/write",
    "👀 Чтение": "/read",
    "🔐 Права": "/permission",
    "⚙️ Умолч.": "/default",
    # Кнопки предыдущей раскладки: пока клиент не получил новую клавиатуру.
    "Новая": "/new",
    "Усилие": "ui:effort",
    "Стоп": "/cancel",
    # Подписи с эмодзи (старая картинка клавиатуры): не должны уходить в агент.
    "⚙️ Модель": "ui:model",
    "🔐 Доступ": "ui:access",
    "🆕 Новая сессия": "/new",
    "📊 Статус": "/status",
    "🔄 Обновить": "/update",
}

#: Версия раскладки: при смене бот один раз присылает новую клавиатуру в чаты.
MENU_VERSION = 8

log = logging.getLogger("telegram-bot")


# ─────────────────────────────────────────── конфиг и состояние


@dataclass
class Config:
    """Настройки бота из ``config.json``."""

    bot_token: str
    bot_username: str = ""
    allowed_chat_ids: list[int] = field(default_factory=list)
    backend: str = "agent"
    deepseek_api_key: str = ""
    fast_model: str = "deepseek-flash"
    fast_max_tokens: int = 4096
    fast_system_prompt: str = "Ты — личный помощник в Telegram. Отвечай по-русски."
    #: Общий лимит хода, мс. 0 — без ограничения: ждём ответ сколько нужно.
    agent_timeout_ms: int = 0
    #: Сколько секунд агент может молчать. 0 — не прерывать молчащий ход.
    idle_timeout_sec: float = 0.0
    agent_model: str = MODEL_FLASH
    agent_reasoning_effort: str = "high"
    default_permission: str = DEFAULT_PERMISSION
    dsh_profile: str = "headless"
    dsh_home: str = ""
    dsh_cwd: str = ""
    max_history: int = 24
    http_enabled: bool = True
    http_host: str = "127.0.0.1"
    http_port: int = 8099
    proxy: str = ""


def load_config() -> Config:
    """Прочитать ``config.json``."""
    raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    http = raw.get("http") or {}
    config = Config(
        bot_token=raw["botToken"],
        bot_username=raw.get("botUsername", ""),
        allowed_chat_ids=[int(x) for x in (raw.get("allowedChatIds") or [])],
        backend=raw.get("backend", "agent"),
        deepseek_api_key=raw.get("deepseekApiKey", ""),
        fast_model=raw.get("fastModel", MODEL_FLASH),
        fast_max_tokens=int(raw.get("fastMaxTokens", 4096)),
        fast_system_prompt=raw.get("fastSystemPrompt", "Ты — личный помощник в Telegram."),
        agent_timeout_ms=int(raw.get("agentTimeoutMs", 0)),
        idle_timeout_sec=float(raw.get("idleTimeoutSec", 0)),
        agent_model=raw.get("agentModel", MODEL_FLASH),
        agent_reasoning_effort=raw.get("agentReasoningEffort", "high"),
        default_permission=raw.get("defaultPermission", DEFAULT_PERMISSION),
        dsh_profile=raw.get("dshProfile", "headless"),
        dsh_home=raw.get("dshHome", ""),
        dsh_cwd=raw.get("dshCwd", str(BASE_DIR)),
        max_history=int(raw.get("maxHistory", 24)),
        http_enabled=bool(http.get("enabled", True)),
        http_host=http.get("host", "127.0.0.1"),
        http_port=int(http.get("port", 8099)),
        proxy=raw.get("proxy", ""),
    )
    if config.agent_model not in MODELS:
        log.warning("agentModel=%r неизвестен, беру %s", config.agent_model, MODEL_FLASH)
        config.agent_model = MODEL_FLASH
    if config.agent_reasoning_effort not in EFFORTS:
        log.warning("agentReasoningEffort=%r неизвестен, беру high", config.agent_reasoning_effort)
        config.agent_reasoning_effort = "high"
    permission = normalize_permission(config.default_permission)
    if permission is None:
        log.warning("defaultPermission=%r неизвестен, беру %s", config.default_permission, DEFAULT_PERMISSION)
        permission = DEFAULT_PERMISSION
    config.default_permission = permission
    return config


def make_session(proxy: str) -> aiohttp.ClientSession:
    """HTTP-сессия; если задан прокси — с коннектором aiohttp_socks."""
    if proxy:
        try:
            from aiohttp_socks import ProxyConnector
            return aiohttp.ClientSession(connector=ProxyConnector.from_url(proxy))
        except ImportError:
            log.warning("прокси задан (%s), но aiohttp_socks не установлен — иду напрямую", proxy)
    return aiohttp.ClientSession()


def make_telegram_session(proxy: str) -> Optional[AiohttpSession]:
    """aiogram-сессия для Telegram; с прокси — AiohttpSession(proxy=...)."""
    return AiohttpSession(proxy=proxy) if proxy else None


def acquire_single_instance() -> Optional[Any]:
    """Взять эксклюзивный замок единственного экземпляра.

    Две копии с одним токеном дерутся за ``getUpdates``: Telegram отдаёт одной
    из них ``409 Conflict``, и бот «моргает». Замок держится открытым файлом —
    на Windows это ``msvcrt.locking``, на остальных системах ``fcntl.flock``.
    Операционная система снимает его сама при завершении процесса, поэтому
    после падения «залипших» блокировок не остаётся.

    :returns: открытый файл-дескриптор (держать до выхода) или ``None``, если
              бот уже запущен.
    """
    try:
        PATCH_DIR.mkdir(parents=True, exist_ok=True)
        handle = open(LOCK_PATH, "a+", encoding="utf-8")
    except OSError as error:
        log.warning("не открыл файл-замок %s: %s", LOCK_PATH, error)
        return None
    try:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        handle.close()
        return None
    handle.seek(0)
    handle.truncate()
    handle.write(str(os.getpid()))
    handle.flush()
    return handle


@dataclass
class ChatState:
    """Состояние одного чата."""

    mode: Optional[str] = None
    model: Optional[str] = None
    effort: Optional[str] = None
    permission: Optional[str] = None
    session_id: Optional[str] = None
    #: Имя чата из Telegram — показывается в /status рядом с номером.
    title: str = ""
    updated_at: float = 0.0


@dataclass
class ApprovalWaiter:
    """Один запрос разрешения, ждущий ответа пользователя."""

    id: str
    chat_id: int
    text: str
    future: asyncio.Future[str]


class State:
    """Владелец бота, состояния чатов и счётчики."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.owner_id: Optional[int] = None
        self.chats: dict[str, ChatState] = {}
        self.stats: dict[str, int] = {"messages": 0, "agentTurns": 0, "fastTurns": 0, "errors": 0}
        self.keyboard_version = 0
        #: Ход, который шёл в момент падения/перезапуска: по нему бот на старте
        #: сообщает «прервано», а не оставляет сообщение с таймером навсегда.
        self.open_turn: Optional[dict] = None
        #: True — бот перезапустился намеренно (после обновления), нужно сказать «Бот обновлён».
        self.restart_notice = False
        self._save_at = 0.0
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        self.owner_id = data.get("ownerId")
        self.keyboard_version = int(data.get("keyboardVersion") or 0)
        for key, value in (data.get("chats") or {}).items():
            self.chats[str(key)] = ChatState(
                mode=value.get("mode"),
                model=value.get("model"),
                effort=value.get("effort"),
                permission=value.get("permission"),
                session_id=value.get("sessionId"),
                title=value.get("title") or "",
                updated_at=float(value.get("updatedAt") or 0),
            )
        self.stats.update({k: int(v) for k, v in (data.get("stats") or {}).items() if isinstance(v, int)})
        self.open_turn = data.get("openTurn") if isinstance(data.get("openTurn"), dict) else None
        self.restart_notice = bool(data.get("restartNotice"))

    def chat(self, chat_id: int) -> ChatState:
        """Состояние чата, при необходимости новое."""
        key = str(chat_id)
        if key not in self.chats:
            self.chats[key] = ChatState()
        return self.chats[key]

    def save(self, force: bool = False) -> None:
        """Сохранить состояние (не чаще раза в секунду)."""
        now = time.monotonic()
        if not force and now - self._save_at < 1.0:
            return
        self._save_at = now
        data = {
            "ownerId": self.owner_id,
            "keyboardVersion": self.keyboard_version,
            "chats": {
                key: {
                    "mode": chat.mode,
                    "model": chat.model,
                    "effort": chat.effort,
                    "permission": chat.permission,
                    "sessionId": chat.session_id,
                    "title": chat.title,
                    "updatedAt": chat.updated_at,
                }
                for key, chat in self.chats.items()
            },
            "stats": self.stats,
            "openTurn": self.open_turn,
            "restartNotice": self.restart_notice,
        }
        try:
            self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as error:
            log.warning("не сохранил state.json: %s", error)


# ─────────────────────────────────────────── логирование


def setup_logging(verbose: bool = False) -> None:
    """Лог в консоль и в файл с простой ротацией."""
    # Консоль Windows по умолчанию в cp1251: часть символов ответа (стрелки,
    # блоки) в лог не влезает и роняет печать. Пишем в UTF-8 с заменой.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError):
            pass
    LOG_DIR.mkdir(exist_ok=True)
    if LOG_PATH.exists() and LOG_PATH.stat().st_size > MAX_LOG_BYTES:
        try:
            LOG_PATH.replace(LOG_PATH.with_suffix(".log.old"))
        except OSError:
            pass
    handlers: list[logging.Handler] = [
        logging.FileHandler(LOG_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=handlers,
    )


# ─────────────────────────────────────────── отправка


def _plain(markdown: str) -> str:
    """Простой текст без разметки — запасной вариант."""
    return markdown


async def _send_safe(bot: Bot, chat_id: int, markdown: str, reply_markup: Any = None) -> None:
    """Отправить кусок как MarkdownV2, при отказе — простым текстом."""
    formatted = md_to_v2(markdown)
    try:
        await bot.send_message(
            chat_id,
            formatted,
            parse_mode=ParseMode.MARKDOWN_V2,
            reply_markup=reply_markup,
        )
        return
    except TelegramBadRequest as error:
        log.warning("MarkdownV2 не принят (%s) — отправляю простым текстом", error.message)
    await bot.send_message(chat_id, _plain(markdown), reply_markup=reply_markup)


async def send_markdown(
    bot: Bot,
    chat_id: int,
    markdown: str,
    reply_markup: Any = None,
) -> None:
    """Отправить длинный ответ частями, каждую — с разметкой.

    ``reply_markup`` вешается только на первое сообщение: клавиатура не должна
    дублироваться на каждом куске длинного ответа.
    """
    first = True
    for raw in split_for_telegram(markdown, 2000):
        if len(md_to_v2(raw)) <= 4000:
            await _send_safe(bot, chat_id, raw, reply_markup if first else None)
            first = False
            continue
        for piece in split_for_telegram(raw, 900):
            await _send_safe(bot, chat_id, piece, reply_markup if first else None)
            first = False


def stop_markup() -> InlineKeyboardMarkup:
    """Кнопка «Остановить»: прервать текущий ход."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="Остановить", callback_data="stop")]
        ]
    )


class Streamer:
    """Живое сообщение: карточка действий и ответ.

    Сверху — «карточка» из блока кода: последние :data:`CARD_OPS` вызовов
    инструментов , она переписывается по ходу работы. Ниже — текст
    ответа: при стриминге обычным текстом, в конце — MarkdownV2.
    """

    def __init__(self, bot: Bot, chat_id: int) -> None:
        self.bot = bot
        self.chat_id = chat_id
        self.text = ""
        self.logs: list[str] = []
        self.ops_total = 0
        self._message_id: Optional[int] = None
        self._task: Optional[asyncio.Task[None]] = None
        self._closed = False
        self._shown: Optional[str] = None
        #: Старт хода и последнее «круглое» значение таймера.
        self._opened_at = time.monotonic()
        self._display_seconds = 0

    def _elapsed(self) -> str:
        """Сколько идёт ход: ``0:05``, ``0:10`` — всегда кратно пяти."""
        seconds = max(0, self._display_seconds)
        return f"{seconds // 60}:{seconds % 60:02d}"

    def _thinking_text(self) -> str:
        """Заголовок ожидания: ``DeepSeek Thinking · 0:42``."""
        return f"{THINKING_TEXT} · {self._elapsed()}"

    def _placeholder(self) -> str:
        """Заглушка, пока агент думает."""
        return self._thinking_text()

    def _stop_markup(self) -> InlineKeyboardMarkup:
        """Кнопка «Остановить» под сообщением."""
        return stop_markup()

    async def _render(self, force: bool = False) -> None:
        """Одна правка: заголовок с таймером и текущий текст ответа."""
        if self._message_id is None:
            return
        view = self.preview_html()
        if not force and view == self._shown:
            return
        self._shown = view
        try:
            await self.bot.edit_message_text(
                text=view,
                chat_id=self.chat_id,
                message_id=self._message_id,
                parse_mode=ParseMode.HTML,
                reply_markup=self._stop_markup(),
            )
        except TelegramRetryAfter as error:
            # Не спим здесь: иначе таймер сдвинется на десятки секунд.
            # Следующий тик через 5 секунд попробует снова.
            log.debug("правка отложена Telegram на %s с", error.retry_after)
        except TelegramBadRequest as error:
            if "not modified" in error.message:
                return
            log.debug("правка HTML не прошла (%s) — правлю простым текстом", error.message)
            try:
                await self.bot.edit_message_text(
                    text=self.preview(),
                    chat_id=self.chat_id,
                    message_id=self._message_id,
                    reply_markup=self._stop_markup(),
                )
            except TelegramBadRequest as plain:
                if "not modified" not in plain.message:
                    log.debug("правка простым текстом не прошла: %s", plain.message)
        except TelegramNetworkError:
            pass

    async def refresh_now(self) -> None:
        """Ручная перерисовка (/refresh), не сдвигая 5-секундную сетку."""
        elapsed = max(0.0, time.monotonic() - self._opened_at)
        self._display_seconds = int(elapsed // REFRESH_INTERVAL) * int(REFRESH_INTERVAL)
        await self._render(force=True)

    async def open(self, initial: Optional[str] = None) -> None:
        """Отправить «Thinking · 0:00» с кнопкой «Остановить»."""
        initial = initial or self._thinking_text()
        try:
            message = await self.bot.send_message(
                self.chat_id,
                initial,
                reply_markup=self._stop_markup(),
            )
            self._message_id = message.message_id
            self._shown = initial
        except (TelegramBadRequest, TelegramNetworkError) as error:
            log.warning("не отправил заготовку: %s", error)
            return
        self._task = asyncio.create_task(self._ticker())

    def set_text(self, text: str) -> None:
        """Заменить текст целиком (агент отдаёт снимок шага)."""
        self.text = text

    def append(self, delta: str) -> None:
        """Дописать дельту (прямой API отдаёт куски)."""
        self.text += delta

    def add_log(self, line: str) -> None:
        """Добавить строку журнала — что агент делает прямо сейчас.

        В карточке живут только последние :data:`CARD_OPS` операций: она должна
        оставаться короткой и читаемой, а не превращаться в портянку.
        """
        self.ops_total += 1
        self.logs.append(line)
        del self.logs[:-CARD_OPS]

    def _card_lines(self) -> list[str]:
        """Карточка действий отключена: в сообщении только «Думаю:» и таймер."""
        return []

    def card_v2(self) -> str:
        """Карточка действий готовым блоком кода MarkdownV2."""
        lines = self._card_lines()
        if not lines:
            return ""
        return "```\n" + escape_code("\n".join(lines)) + "\n```"

    def _card_html(self) -> str:
        """Та же карточка как ``<pre>`` для промежуточных правок."""
        lines = self._card_lines()
        if not lines:
            return ""
        return "<pre>" + html.escape("\n".join(lines), quote=False) + "</pre>"

    def preview(self) -> str:
        """Промежуточная правка простым текстом (запасной путь)."""
        parts = [self._thinking_text()]
        card = "\n".join(self._card_lines())
        if card:
            parts.append(card)
        if self.text:
            parts.append(self.text)
        full = "\n\n".join(parts)
        if len(full) > STREAM_LIMIT:
            return full[:STREAM_LIMIT] + " …"
        return full

    def preview_html(self) -> str:
        """Промежуточная правка: заголовок с таймером и ответ текстом.

        Именно ``<pre>`` даёт в Telegram моноширинный блок с горизонтальной
        прокруткой: команды с путями не разваливаются по переносам. Бюджет
        подбирается по уже экранированной строке — ``&`` и ``<`` в тексте
        растягивают её, и правка не должна упереться в лимит Telegram.
        """
        header = html.escape(self._thinking_text(), quote=False)
        card = self._card_html()
        budget = max(200, STREAM_LIMIT - len(card) - len(header))
        while True:
            body = html.escape(self.text[:budget], quote=False)
            view = "\n\n".join(part for part in (header, card, body) if part)
            if len(view) <= STREAM_LIMIT or budget <= 200:
                return view
            budget = max(200, int(budget * 0.85))

    async def _ticker(self) -> None:
        """Перерисовывать сообщение строго раз в :data:`REFRESH_INTERVAL`.

        Таймер считается от старта хода и всегда показывает «круглые»
        значения 5, 10, 15… Если правка задержалась (сеть, RetryAfter),
        пропущенные тики не догоняются пачкой: берём следующий круглый тик.
        """
        assert self._message_id is not None
        interval = REFRESH_INTERVAL
        next_tick = self._opened_at + interval
        while not self._closed:
            now = time.monotonic()
            if next_tick > now:
                await asyncio.sleep(next_tick - now)
            if self._closed:
                return
            # Сдвигаем сетку на следующий будущий тик и показываем последний
            # наступивший — без догоняющих правок и без дрейфа.
            now = time.monotonic()
            while next_tick <= now:
                next_tick += interval
            self._display_seconds = max(0, int(next_tick - interval - self._opened_at))
            await self._render()

    def _status_line(self, state: str) -> str:
        """Итог хода: «Готово», «Прервано», «Ошибка» — без таймера."""
        return {"done": "Готово", "canceled": "Прервано", "error": "Ошибка"}.get(state, "Готово")

    async def finish(self, markdown: str, state: str = "done") -> None:
        """Закрыть потоковое сообщение и записать итог: статус + Markdown."""
        self._closed = True
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
            self._task = None

        text = (markdown or "").strip() or "(пустой ответ)"
        status = self._status_line(state)
        limit = max(600, 2000 - len(status))
        chunks = split_for_telegram(text, limit)

        if self._message_id is not None and chunks:
            first = chunks[0]
            formatted = f"{status}\n\n{md_to_v2(first)}"
            edited = False
            if len(formatted) <= 4096:
                try:
                    await self.bot.edit_message_text(
                        text=formatted,
                        chat_id=self.chat_id,
                        message_id=self._message_id,
                        parse_mode=ParseMode.MARKDOWN_V2,
                        reply_markup=InlineKeyboardMarkup(inline_keyboard=[]),
                    )
                    edited = True
                except TelegramBadRequest as error:
                    if "not modified" in error.message:
                        edited = True
                    else:
                        log.warning("итоговый MarkdownV2 не принят (%s)", error.message)
            if not edited:
                plain = f"{status}\n\n{first}"
                try:
                    await self.bot.edit_message_text(
                        text=plain[:4096],
                        chat_id=self.chat_id,
                        message_id=self._message_id,
                        reply_markup=InlineKeyboardMarkup(inline_keyboard=[]),
                    )
                    edited = True
                except TelegramBadRequest as error:
                    if "not modified" not in error.message:
                        log.warning("итоговая правка не прошла: %s", error.message)
            if not edited:
                await send_markdown(self.bot, self.chat_id, first)
            chunks = chunks[1:]

        for chunk in chunks:
            await send_markdown(self.bot, self.chat_id, chunk)


# ─────────────────────────────────────────── бот


class Bridge:
    """Состояние приложения: конфиг, бот, агент, чаты."""

    def __init__(self, cfg: Config) -> None:
        self.cfg = cfg
        self.state = State(STATE_PATH)
        self.session = make_session(cfg.proxy)
        self.bot = Bot(
            token=cfg.bot_token,
            default=DefaultBotProperties(parse_mode=None),
            session=make_telegram_session(cfg.proxy),
        )
        self.router = Router()
        self.dispatcher = Dispatcher()
        self.dispatcher.include_router(self.router)
        self.dispatcher.message.outer_middleware(self._access_middleware)
        self.running: dict[str, asyncio.Task[None]] = {}
        #: Когда начался текущий ход — для таймера в /status.
        self.turn_started: dict[str, float] = {}
        #: Идёт перезапуск — второй раз не начинаем.
        self._restarting = False
        self.history: dict[str, list[dict[str, str]]] = {}
        #: Активные «живые» сообщения: /refresh перерисовывает их вручную.
        self.streamers: dict[int, Streamer] = {}
        # Команда → обработчик: нужно, чтобы кнопки клавиатуры вызывали те же
        # действия, что и ручной ввод «/…».
        self._command_handlers: dict[str, Any] = {}
        #: Запросы разрешений: очередь на чат и одно сообщение на всю пачку.
        self._approvals: dict[int, list[ApprovalWaiter]] = {}
        self._approval_messages: dict[int, int] = {}
        self._approval_lock = asyncio.Lock()
        #: Локальный секрет: approval-запросы принимаются только от нашего DSH.
        self._approval_token = secrets.token_urlsafe(24)
        self.started_at = time.monotonic()
        self.agent = self._build_agent()
        self._panel: Optional[web.AppRunner] = None
        self._restart_task: Optional[asyncio.Task[None]] = None
        self._register_handlers()

    # --- инфраструктура

    def _build_agent(self) -> Optional[AgentRunner]:
        bin_js = resolve_dsh_bin()
        if bin_js is None:
            log.warning("dsh не найден — режим агента будет недоступен")
            return None
        return AgentRunner(
            bin_js=bin_js,
            cwd=Path(self.cfg.dsh_cwd),
            dsh_home=Path(self.cfg.dsh_home) if self.cfg.dsh_home else None,
            profile=self.cfg.dsh_profile,
            timeout=self.cfg.agent_timeout_ms / 1000,
            idle_timeout=self.cfg.idle_timeout_sec,
            patch_dir=PATCH_DIR,
            approval_url=(
                f"http://127.0.0.1:{self.cfg.http_port}/approval"
                if self.cfg.http_enabled
                else None
            ),
            approval_token=self._approval_token,
        )

    def _consume_restart_flag(self) -> bool:
        """Удалить ``.runtime/restart.flag``; True — перезапуск запрошен."""
        flag = PATCH_DIR / "restart.flag"
        try:
            if not flag.exists():
                return False
            flag.unlink()
            return True
        except OSError as error:
            log.warning("restart.flag: %s", error)
            return False

    async def _watch_restart(self) -> None:
        """Перезапуск по флагу: предупредить, дать 10 с и выйти.

        Флаг ставит сам агент во время своего хода, поэтому ход не ждём —
        иначе бот и агент ждут друг друга (взаимная блокировка). Супервизор
        ``start.ps1`` поднимает бота после ненулевого кода выхода.
        """
        log.info("watchdog перезапуска: %s", PATCH_DIR / "restart.flag")
        while True:
            await asyncio.sleep(2)
            if self._consume_restart_flag():
                await self._begin_restart("флаг перезапуска", wait_for_turns=False)
                return

    async def _notify_owner(self, text: str) -> None:
        """Сообщение владельцу: его chat id сохранён в state.json."""
        chat_id = self.state.owner_id
        if not chat_id:
            return
        try:
            await send_markdown(self.bot, chat_id, text)
        except Exception as error:  # noqa: BLE001 — сообщение не критично
            log.warning("не отправил сообщение владельцу: %s", error)

    async def _begin_restart(self, reason: str = "обновление", wait_for_turns: bool = True) -> None:
        """Перезапуск: предупредить в чате, дать 10 с, выйти.

        ``wait_for_turns`` — дождаться ли идущих ходов агента. Флаг перезапуска
        ставит сам агент: его ход в этот момент ещё идёт и ждёт перезапуска,
        поэтому ждать его бессмысленно — будет взаимная блокировка.
        """
        if self._restarting:
            return
        self._restarting = True
        log.info("перезапуск (%s) через %s с", reason, RESTART_DELAY_SEC)
        await self._notify_owner(f"Через {RESTART_DELAY_SEC} секунд бот будет перезапущен ({reason}).")
        self.state.restart_notice = True
        self.state.save(force=True)
        await asyncio.sleep(RESTART_DELAY_SEC)
        await self._notify_owner("Перезапускаю…")
        if wait_for_turns:
            # Не обрываем живой ответ: ждём, пока ходы закончатся (до 5 минут).
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                if not any(not task.done() for task in self.running.values()):
                    break
                await asyncio.sleep(2)
        else:
            # Ход, поставивший флаг, сам ждёт перезапуска — ждать его нельзя.
            # Даём только паузу на доставку уже готовых сообщений.
            await asyncio.sleep(RESTART_GRACE_SEC)
        os._exit(1)

    def _model_for(self, chat: ChatState, mode: str) -> str:
        """Модель чата: выбранная командой или умолчание для режима."""
        if chat.model in MODELS:
            return chat.model
        return self.cfg.fast_model if mode == "fast" else self.cfg.agent_model

    def _effort_for(self, chat: ChatState) -> str:
        """Усилие чата: выбранное командой или умолчание из конфига."""
        if chat.effort in EFFORTS:
            return chat.effort
        return self.cfg.agent_reasoning_effort

    def _current_mode(self, chat_id: int) -> str:
        return self.state.chat(chat_id).mode or self.cfg.backend

    def _permission_for(self, chat: ChatState) -> str:
        """Права чата: выбранные командой или умолчание из конфига."""
        return normalize_permission(chat.permission) or self.cfg.default_permission

    def _permission_title(self, name: str) -> str:
        """Короткое человеческое название прав."""
        return PERMISSION_TITLES.get(name, name)

    def _settings_line(self, chat_id: int) -> str:
        """Две строки: «DeepSeek Flash · high» и «доступ: …»."""
        chat = self.state.chat(chat_id)
        mode = chat.mode or self.cfg.backend
        permission = self._permission_for(chat)
        model = self._model_for(chat, mode)
        title = MODEL_TITLES.get(model, model)
        return (
            f"**{title}** · **{self._effort_for(chat)}**\n"
            f"доступ: **{self._permission_title(permission)}**"
        )

    def _settings_plain(self, chat_id: int) -> str:
        """Настройки без разметки — для inline-панелей."""
        chat = self.state.chat(chat_id)
        mode = chat.mode or self.cfg.backend
        return (
            f"режим: {mode} · модель: {self._model_for(chat, mode)} · "
            f"усилие: {self._effort_for(chat)}\n"
            f"доступ: {self._permission_for(chat)}"
        )

    def _permission_text(self, chat_id: int) -> str:
        """Справка по правам: что включено сейчас и как это сменить."""
        chat = self.state.chat(chat_id)
        current = self._permission_for(chat)
        source = "выбрано в этом чате" if chat.permission else "умолчание бота"
        lines = [
            "**🔐 Доступ агента**",
            f"сейчас: {PERMISSION_ICONS.get(current, '🔐')} **{self._permission_title(current)}** "
            f"(`{current}`, {source})",
            "",
        ]
        for name in PERMISSIONS:
            mark = "→" if name == current else "•"
            lines.append(f"{mark} `{name}` — {PERMISSION_HINTS[name]}")
        lines.extend(
            [
                "",
                "**Сменить**",
                "/full — полный доступ (`danger-full-access`), без подтверждений",
                "/write — запись только в рабочую папку",
                "/read — только чтение",
                "/permission <имя> — то же самое вручную",
                "",
                "Права закрепляются за сессией агента при её создании, поэтому смена "
                "прав начинает новую сессию: контекст агента сбрасывается.",
            ]
        )
        return "\n".join(lines)

    def _allowed(self, chat_id: int) -> bool | str:
        """Доступ: разрешён, запрещён или «первый стал владельцем»."""
        if chat_id in self.cfg.allowed_chat_ids:
            return True
        if self.state.owner_id is not None and chat_id == self.state.owner_id:
            return True
        if self.state.owner_id is None and not self.cfg.allowed_chat_ids:
            return "claim"
        return False

    async def _access_middleware(self, handler, event: Message, data) -> Any:
        """Пускать только владельца и разрешённые чаты."""
        chat_id = event.chat.id
        title = getattr(event.chat, "title", None) or getattr(event.chat, "full_name", None) or "личный чат"
        state = self.state.chat(chat_id)
        if state.title != title:
            state.title = title
            self.state.save()
        allowed = self._allowed(chat_id)
        if allowed == "claim":
            self.state.owner_id = chat_id
            self.state.save(force=True)
            log.info("владелец бота: %s (@%s)", chat_id, event.from_user.username if event.from_user else "—")
            return await handler(event, data)
        if not allowed:
            username = f"@{event.from_user.username}" if event.from_user and event.from_user.username else "—"
            log.warning("отказ в доступе: %s (%s)", chat_id, username)
            try:
                await event.answer(
                    f"Доступ закрыт.\nТвой chat id: {chat_id}\n"
                    "Владелец может добавить его в config.json → allowedChatIds"
                )
            except TelegramBadRequest:
                pass
            return None
        return await handler(event, data)

    # --- команды

    def _help_text(self, chat_id: int) -> str:
        """Короткая справка — без списка команд."""
        return "\n".join(
            [
                "**🧠 DeepSeek-бот на связи**",
                "",
                "Просто напиши вопрос — отвечу.",
                "Настройки — кнопками внизу.",
                f"Сейчас: {self._settings_line(chat_id)}",
            ]
        )

    def _chat_label(self, chat_id: int) -> str:
        """Номер чата и его имя: «#1 — Иван»."""
        key = str(chat_id)
        keys = list(self.state.chats)
        number = keys.index(key) + 1 if key in keys else len(keys) + 1
        return f"#{number} — {self.state.chat(chat_id).title or 'личный чат'}"

    def _status_text(self, chat_id: int) -> str:
        """Сводка состояния обычным Markdown."""
        chat = self.state.chat(chat_id)
        key = str(chat_id)
        task = self.running.get(key)
        if task is not None and not task.done():
            started = self.turn_started.get(key)
            timer = ""
            if started:
                seconds = max(0, int(time.time() - started))
                timer = f" · {seconds // 60}:{seconds % 60:02d}"
            busy = f"идёт запрос с DeepSeek{timer}"
        else:
            busy = "свободен"
        model = MODEL_TITLES.get(self._model_for(chat, chat.mode or self.cfg.backend), chat.model or "")
        return "\n".join(
            [
                "**Состояние бота**",
                f"сейчас: **{busy}**",
                f"чат: **{self._chat_label(chat_id)}**",
                f"модель: **{model}** · усилие: **{self._effort_for(chat)}**",
                f"доступ: **{self._permission_title(self._permission_for(chat))}**",
            ]
        )

    async def _switch_model(self, message: Message, model: str) -> None:
        """Переключить модель чата и подтвердить выбор."""
        chat = self.state.chat(message.chat.id)
        chat.model = model
        self.state.save(force=True)
        await send_markdown(self.bot, message.chat.id, self._settings_line(message.chat.id))

    async def _switch_effort(self, message: Message, effort: str) -> None:
        """Переключить усилие чата и подтвердить выбор."""
        chat = self.state.chat(message.chat.id)
        chat.effort = effort
        self.state.save(force=True)
        text = self._settings_line(message.chat.id)
        if self._current_mode(message.chat.id) == "fast":
            text += "\n\nВ /fast усилие уходит как `reasoning_effort`; если API его не примет, запрос повторится без него."
        await send_markdown(self.bot, message.chat.id, text)

    def _apply_permission(self, chat: ChatState, name: str) -> bool:
        """Записать права чата и сбросить сессию агента.

        Права закреплены за сессией при её создании, поэтому их смена начинает
        новую сессию. Возвращает ``True``, если права действительно изменились
        и сессию пришлось сбросить.
        """
        if chat.permission == name:
            return False
        chat.permission = name
        chat.session_id = None
        return True

    async def _switch_permission(self, message: Message, raw: str) -> None:
        """Переключить права чата.

        Права — это песочница DSH и политика подтверждений. Они закрепляются за
        сессией при её создании и дальше не меняются, поэтому смена прав
        начинает новую сессию: иначе ``dsh`` продолжил бы старую с прежними
        правами, и переключатель бы «не работал».
        """
        name = normalize_permission(raw)
        if name is None:
            await send_markdown(
                self.bot,
                message.chat.id,
                f"Не знаю такой доступ: `{raw}`.\nЕсть /full, /write, /read — "
                "или `/permission danger-full-access`.",
            )
            return

        chat = self.state.chat(message.chat.id)
        if chat.permission == name:
            await send_markdown(
                self.bot,
                message.chat.id,
                f"{PERMISSION_ICONS.get(name, '🔐')} Доступ уже такой: "
                f"**{self._permission_title(name)}** (`{name}`).\n{self._settings_line(message.chat.id)}",
            )
            return

        had_session = chat.session_id is not None
        self._apply_permission(chat, name)
        self.state.save(force=True)

        text = (
            f"{PERMISSION_ICONS.get(name, '🔐')} Доступ: **{self._permission_title(name)}** "
            f"(`{name}`)\n{self._settings_line(message.chat.id)}"
        )
        if had_session:
            text += "\n\n🆕 Права действуют с новой сессии агента — контекст сброшен."
        text += "\n\nСледующий запрос пойдёт уже с этими правами."
        await send_markdown(self.bot, message.chat.id, text)

    def _set_default_permission(self, name: str) -> None:
        """Записать новый defaultPermission в config.json."""
        self.cfg.default_permission = name
        try:
            raw = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            raw["defaultPermission"] = name
            CONFIG_PATH.write_text(
                json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
        except OSError as error:
            log.warning("не смог сохранить defaultPermission: %s", error)

    def _menu_keyboard(self) -> ReplyKeyboardMarkup:
        """Нижняя клавиатура со всеми действиями бота."""
        return ReplyKeyboardMarkup(
            keyboard=[
                [KeyboardButton(text=label) for label, _ in row]
                for row in MENU_ROWS
            ],
            resize_keyboard=True,
            is_persistent=True,
            input_field_placeholder="Напиши вопрос или выбери действие",
        )

    @staticmethod
    def _option_button(label: str, active: bool, callback_data: str) -> InlineKeyboardButton:
        """Кнопка варианта: галочка у текущего выбора."""
        return InlineKeyboardButton(
            text=("• " if active else "") + label,
            callback_data=callback_data,
        )

    #: Первая строка панели → раздел: по ней видно, куда возвращаться после
    #: выбора, не таская лишние поля в ``callback_data`` (там всего 64 байта).
    PANEL_TITLES: tuple[tuple[str, str], ...] = (
        ("⚙️ Модель", "model"),
        ("🎚 Усилие", "effort"),
        ("🔐 Доступ агента", "access"),
        ("⚙️ Доступ по умолчанию", "default"),
    )

    @classmethod
    def panel_of(cls, text: Optional[str]) -> str:
        """Раздел панели по её первой строке; пусто — раздел не распознан."""
        for title, section in cls.PANEL_TITLES:
            if (text or "").lstrip().startswith(title):
                return section
        return ""

    def _section_view(self, section: str, chat_id: int) -> tuple[str, InlineKeyboardMarkup]:
        """Текст и кнопки inline-панели: model, effort, access, default."""
        chat = self.state.chat(chat_id)
        mode = chat.mode or self.cfg.backend

        if section not in {"model", "effort", "access", "default"}:
            section = "model"

        if section == "model":
            current = self._model_for(chat, mode)
            current_effort = self._effort_for(chat)
            text = (
                "⚙️ Модель\n"
                f"Сейчас: {current} · усилие {current_effort}\n\n"
                "⚡️ Flash — быстрая: короткие ответы и простые задачи.\n"
                "🧠 Pro — сильная: код, анализ, сложные задачи.\n\n"
                "После выбора модели откроется усилие."
            )
            rows = [
                [self._option_button("Flash", current == MODEL_FLASH, f"pick:model:{MODEL_FLASH}")],
                [self._option_button("Pro", current == MODEL_PRO, f"pick:model:{MODEL_PRO}")],
                [InlineKeyboardButton(text="✖️ Закрыть панель", callback_data="ui:close")],
            ]
            return text, InlineKeyboardMarkup(inline_keyboard=rows)

        if section == "effort":
            current = self._effort_for(chat)
            model = self._model_for(chat, mode)
            text = (
                "🎚 Усилие рассуждений\n"
                f"Модель: {model}\n"
                f"Сейчас: {current}\n\n"
                "Low — быстрее, меньше рассуждений.\n"
                "High — баланс скорости и качества.\n"
                "Max — максимум качества, дольше."
            )
            rows = [
                [
                    self._option_button("Low", current == "low", "pick:effort:low"),
                    self._option_button("High", current == "high", "pick:effort:high"),
                    self._option_button("Max", current == "max", "pick:effort:max"),
                ],
                [InlineKeyboardButton(text="✖️ Закрыть панель", callback_data="ui:close")],
            ]
            return text, InlineKeyboardMarkup(inline_keyboard=rows)

        if section == "access":
            current = self._permission_for(chat)
            text = (
                "🔐 Доступ агента\n"
                f"Сейчас: {PERMISSION_ICONS.get(current, '🔐')} {self._permission_title(current)}\n\n"
                "🔓 Полный — любые файлы и команды, без подтверждений.\n"
                "✍️ Запись — менять файлы только в рабочей папке.\n"
                "👀 Чтение — только смотреть, ничего не менять.\n\n"
                "Смена доступа начинает новую сессию: контекст агента сбрасывается."
            )
            rows = [
                [
                    self._option_button(
                        "🔓 Полный доступ",
                        current == "danger-full-access",
                        "pick:access:danger-full-access",
                    )
                ],
                [
                    self._option_button(
                        "✍️ Запись в папку",
                        current == "workspace-write",
                        "pick:access:workspace-write",
                    )
                ],
                [
                    self._option_button(
                        "👀 Только чтение",
                        current == "read-only",
                        "pick:access:read-only",
                    )
                ],
                [InlineKeyboardButton(text="Доступ по умолчанию", callback_data="ui:default")],
                [InlineKeyboardButton(text="✖️ Закрыть панель", callback_data="ui:close")],
            ]
            return text, InlineKeyboardMarkup(inline_keyboard=rows)

        current = self.cfg.default_permission
        chat_perm = self._permission_for(chat)
        text = (
            "⚙️ Доступ по умолчанию\n"
            f"Для новых чатов: {PERMISSION_ICONS.get(current, '🔐')} {self._permission_title(current)}\n"
            f"В этом чате: {PERMISSION_ICONS.get(chat_perm, '🔐')} {self._permission_title(chat_perm)}\n\n"
            "Меняется здесь.\n"
            "На уже начатые чаты это не влияет."
        )
        rows = [
            [
                self._option_button(
                    "🔓 Полный доступ",
                    current == "danger-full-access",
                    "pick:default:danger-full-access",
                )
            ],
            [
                self._option_button(
                    "✍️ Запись в папку",
                    current == "workspace-write",
                    "pick:default:workspace-write",
                )
            ],
            [
                self._option_button(
                    "👀 Только чтение",
                    current == "read-only",
                    "pick:default:read-only",
                )
            ],
            [InlineKeyboardButton(text="✖️ Закрыть панель", callback_data="ui:close")],
        ]
        return text, InlineKeyboardMarkup(inline_keyboard=rows)

    async def _send_inline_menu(self, chat_id: int, section: str = "model") -> None:
        """Отправить inline-панель отдельным сообщением."""
        text, markup = self._section_view(section, chat_id)
        await self.bot.send_message(chat_id, text, reply_markup=markup)

    async def _edit_inline_menu(self, callback: CallbackQuery, section: str) -> None:
        """Обновить inline-панель в том же сообщении; при отказе — прислать заново."""
        if callback.message is None:
            await self._send_inline_menu(callback.from_user.id, section)
            return
        chat_id = callback.message.chat.id
        text, markup = self._section_view(section, chat_id)
        try:
            await callback.message.edit_text(text, reply_markup=markup)
        except TelegramBadRequest as error:
            if "message is not modified" in (error.message or ""):
                return
            log.warning("inline-панель не обновилась: %s", error.message)
            await self._send_inline_menu(chat_id, section)

    async def _close_panel(self, callback: CallbackQuery) -> None:
        """Удалить сообщение inline-панели."""
        if callback.message is not None:
            try:
                await callback.message.delete()
            except TelegramBadRequest:
                pass

    async def _pick_option(self, chat_id: int, section: str, value: str) -> Optional[str]:
        """Применить вариант, выбранный в панели.

        Настройки меняются молча, а панель тут же перерисовывается: иначе один
        тап по «Flash» присылал бы ещё и отдельное сообщение, и чат тонул бы в
        подтверждениях. Возвращает текст всплывающей подсказки; ``None`` —
        кнопка устарела, такого варианта больше нет.
        """
        chat = self.state.chat(chat_id)
        if section == "mode":
            if value not in {"agent", "fast"}:
                return None
            chat.mode = value
            self.state.save(force=True)
            return f"Режим: {value}"
        if section == "model":
            if value not in MODELS:
                return None
            chat.model = value
            self.state.save(force=True)
            return f"Модель: {value}"
        if section == "effort":
            if value not in EFFORTS:
                return None
            chat.effort = value
            self.state.save(force=True)
            return f"Усилие: {value}"
        if section == "access":
            name = normalize_permission(value)
            if name is None:
                return None
            reset = self._apply_permission(chat, name)
            self.state.save(force=True)
            return f"Доступ: {name}" + (" · новая сессия" if reset else "")
        if section == "default":
            name = normalize_permission(value)
            if name is None:
                return None
            self._set_default_permission(name)
            return f"Умолчание: {name}"
        return None

    async def _ui_action(self, callback: CallbackQuery, action: str) -> Optional[str]:
        """Обработать кнопку панели; вернуть текст всплывающей подсказки."""
        chat_id = callback.message.chat.id if callback.message else callback.from_user.id
        if action in {"model", "effort", "access", "default"}:
            await self._edit_inline_menu(callback, action)
            return None
        if action == "close":
            await self._close_panel(callback)
            return None
        if action == "hide":
            await self.bot.send_message(
                chat_id,
                "🙈 Клавиатура скрыта.",
                reply_markup=ReplyKeyboardRemove(),
            )
            return "Клавиатура скрыта"
        if action == "menu":
            await self.bot.send_message(
                chat_id,
                "⌨️ Клавиатура действий внизу 👇",
                reply_markup=self._menu_keyboard(),
            )
            return "Клавиатура показана"
        return "Кнопка устарела — открой настройки заново"

    async def _run_menu_command(self, chat_id: int, command: str) -> None:
        """Выполнить команду, выбранную кнопкой клавиатуры.

        Обработчики команд ждут объект ``Message``; кнопке достаточно ``chat.id``
        и текста команды, поэтому передаём лёгкую заглушку — логика остаётся
        одна и та же, что и при ручном вводе «/…». Аргументы вроде
        ``/default full`` обрабатываются тем же обработчиком ``/default``.
        """
        handler = self._command_handlers.get(command.split()[0])
        if handler is None:
            await send_markdown(self.bot, chat_id, f"Не знаю команду `{command}`.")
            return
        stub = SimpleNamespace(chat=SimpleNamespace(id=chat_id), text=command)
        await handler(stub)

    def _register_handlers(self) -> None:
        router = self.router

        def command(*names: str):
            """Зарегистрировать команду и запомнить обработчик для клавиатуры."""
            def decorator(handler):
                for name in names:
                    self._command_handlers[f"/{name}"] = handler
                router.message(Command(*names))(handler)
                return handler

            return decorator

        @router.message(CommandStart())
        @command("help")
        async def on_start(message: Message) -> None:
            await send_markdown(
                self.bot,
                message.chat.id,
                self._help_text(message.chat.id),
                reply_markup=self._menu_keyboard(),
            )

        # /start обрабатывается CommandStart, но пусть будет и в карте команд:
        # так его можно вызвать тем же путём, что и кнопки клавиатуры.
        self._command_handlers["/start"] = on_start

        @command("id")
        async def on_id(message: Message) -> None:
            await send_markdown(
                self.bot,
                message.chat.id,
                f"chat id: `{message.chat.id}`\n{self._settings_line(message.chat.id)}",
            )

        @command("agent")
        async def on_agent(message: Message) -> None:
            chat = self.state.chat(message.chat.id)
            chat.mode = "agent"
            self.state.save(force=True)
            await send_markdown(
                self.bot,
                message.chat.id,
                self._settings_line(message.chat.id),
            )

        @command("fast")
        async def on_fast(message: Message) -> None:
            chat = self.state.chat(message.chat.id)
            chat.mode = "fast"
            self.state.save(force=True)
            await send_markdown(
                self.bot,
                message.chat.id,
                self._settings_line(message.chat.id),
            )

        @command("flash")
        async def on_flash(message: Message) -> None:
            await self._switch_model(message, MODEL_FLASH)

        @command("pro")
        async def on_pro(message: Message) -> None:
            await self._switch_model(message, MODEL_PRO)

        @command("permission", "permissions", "access")
        async def on_permission(message: Message) -> None:
            parts = (message.text or "").split()
            if len(parts) < 2:
                await send_markdown(self.bot, message.chat.id, self._permission_text(message.chat.id))
                return
            await self._switch_permission(message, parts[1])

        @command("full", "fullaccess")
        async def on_full(message: Message) -> None:
            await self._switch_permission(message, "danger-full-access")

        @command("write", "workspace")
        async def on_write(message: Message) -> None:
            await self._switch_permission(message, "workspace-write")

        @command("read", "readonly")
        async def on_read(message: Message) -> None:
            await self._switch_permission(message, "read-only")

        @command("default")
        async def on_default(message: Message) -> None:
            parts = (message.text or "").split()
            if len(parts) < 2:
                await send_markdown(
                    self.bot,
                    message.chat.id,
                    f"⚙️ Доступ по умолчанию для новых чатов: "
                    f"**{self._permission_title(self.cfg.default_permission)}** "
                    f"(`{self.cfg.default_permission}`).\n"
                    "Сменить: `/default full`, `/default write`, `/default read`.",
                )
                return
            name = normalize_permission(parts[1])
            if name is None:
                await send_markdown(self.bot, message.chat.id, "Не знаю такой доступ. Есть full / write / read.")
                return
            self._set_default_permission(name)
            await send_markdown(
                self.bot,
                message.chat.id,
                f"⚙️ Доступ по умолчанию для новых чатов: **{self._permission_title(name)}** (`{name}`).",
            )

        @command(*EFFORTS)
        async def on_effort(message: Message) -> None:
            name = (message.text or "").split()[0].lstrip("/").split("@")[0].lower()
            if name not in EFFORTS:
                await send_markdown(self.bot, message.chat.id, "Не понял усилие. Есть /low, /high, /max.")
                return
            await self._switch_effort(message, name)

        @command("update", "reload")
        async def on_update(message: Message) -> None:
            """Перезапуск бота: подхватить правки кода (кнопка «Обновить»)."""
            await self._begin_restart("обновление бота")

        @command("new", "reset")
        async def on_new(message: Message) -> None:
            chat = self.state.chat(message.chat.id)
            parts = (message.text or "").split()
            if len(parts) >= 2:
                name = normalize_permission(parts[1])
                if name is None:
                    await send_markdown(
                        self.bot,
                        message.chat.id,
                        "Не знаю такой доступ. Есть `/new full`, `/new write`, `/new read`.",
                    )
                    return
                chat.permission = name
            chat.session_id = None
            self.history.pop(str(message.chat.id), None)
            self.state.save(force=True)
            perm = self._permission_for(chat)
            await send_markdown(
                self.bot,
                message.chat.id,
                "🆕 Контекст сброшен, начинаем с чистого листа.\n"
                f"{PERMISSION_ICONS.get(perm, '🔐')} Доступ: **{self._permission_title(perm)}** (`{perm}`).",
            )

        @command("cancel", "stop")
        async def on_cancel(message: Message) -> None:
            task = self.running.get(str(message.chat.id))
            if task is not None and not task.done():
                task.cancel()
                await send_markdown(self.bot, message.chat.id, "Останавливаю…")
                return
            await send_markdown(self.bot, message.chat.id, "Нечего отменять.")

        @command("status")
        async def on_status(message: Message) -> None:
            await send_markdown(self.bot, message.chat.id, self._status_text(message.chat.id))

        @command("refresh")
        async def on_refresh(message: Message) -> None:
            """Обновить живое сообщение; без активного хода — показать статус."""
            chat_id = message.chat.id
            streamer = self.streamers.get(chat_id)
            if streamer is not None:
                await streamer.refresh_now()
                return
            await send_markdown(self.bot, chat_id, self._status_text(chat_id))

        @command("ping")
        async def on_ping(message: Message) -> None:
            await send_markdown(self.bot, message.chat.id, "pong")

        @router.message(F.text.in_(set(MENU_ACTIONS) | set(LEGACY_MENU_ACTIONS)))
        async def on_menu_button(message: Message) -> None:
            """Нажатие кнопки нижней клавиатуры: команда или inline-панель."""
            text = (message.text or "").strip()
            action = MENU_ACTIONS.get(text) or LEGACY_MENU_ACTIONS[text]
            if action.startswith("ui:"):
                await self._send_inline_menu(message.chat.id, action.split(":", 1)[1])
                return
            await self._run_menu_command(message.chat.id, action)

        @router.callback_query(F.data.startswith("ui:"))
        async def on_ui_callback(callback: CallbackQuery) -> None:
            """Кнопки inline-панели: разделы, настройки и сервисные действия."""
            chat_id = callback.message.chat.id if callback.message else callback.from_user.id
            if self._allowed(chat_id) is False:
                await callback.answer("Доступ закрыт", show_alert=True)
                return
            action = (callback.data or "").split(":", 1)[1]
            toast = await self._ui_action(callback, action)
            await callback.answer(toast or "")

        @router.callback_query(F.data.startswith("pick:"))
        async def on_pick_callback(callback: CallbackQuery) -> None:
            """Выбор варианта в inline-панели (модель, усилие, доступ)."""
            chat_id = callback.message.chat.id if callback.message else callback.from_user.id
            if self._allowed(chat_id) is False:
                await callback.answer("Доступ закрыт", show_alert=True)
                return
            try:
                _, section, value = (callback.data or "").split(":", 2)
            except ValueError:
                await callback.answer("Кнопка устарела — открой меню заново", show_alert=True)
                return
            toast = await self._pick_option(chat_id, section, value)
            if toast is None:
                await callback.answer("Кнопка устарела — открой настройки заново", show_alert=True)
                return
            await callback.answer(toast)
            # Модель → усилие: усилие появляется само после выбора модели,
            # а после усилия панель закрывается — возвращаемся в чат.
            if section == "model":
                await self._edit_inline_menu(callback, "effort")
                return
            if section == "effort":
                await self._close_panel(callback)
                return
            next_section = self.panel_of(callback.message.text if callback.message else "")
            await self._edit_inline_menu(callback, next_section)

        @router.callback_query(F.data == "stop")
        async def on_stop(callback: CallbackQuery) -> None:
            """Кнопка «Остановить»: прервать текущий ход."""
            chat_id = callback.message.chat.id if callback.message else callback.from_user.id
            if self._allowed(chat_id) is False:
                await callback.answer("Доступ закрыт", show_alert=True)
                return
            task = self.running.get(str(chat_id))
            if task is not None and not task.done():
                task.cancel()
                await callback.answer("Останавливаю…")
                return
            await callback.answer("Нечего останавливать")

        @router.callback_query(
            F.data.startswith("refresh:")
            | (F.data == "clock")
            | F.data.startswith("tick:")
        )
        async def on_stale_timer(callback: CallbackQuery) -> None:
            """Старые кнопки «Обновить»/таймера из прошлых сообщений."""
            await callback.answer("Кнопка устарела")

        @router.callback_query(F.data.startswith("approve:") | F.data.startswith("reject:"))
        async def on_approval_click(callback: CallbackQuery) -> None:
            """Разрешить/отменить запрос из approval-сообщения."""
            chat_id = callback.message.chat.id if callback.message else callback.from_user.id
            if self._allowed(chat_id) is False:
                await callback.answer("Доступ закрыт", show_alert=True)
                return
            action, _, request_id = (callback.data or "").partition(":")
            allow = action == "approve"
            resolved = await self._resolve_approval(chat_id, request_id, allow)
            if not resolved:
                await callback.answer("Запрос уже обработан")
            elif allow:
                await callback.answer("Разрешено")
            else:
                await callback.answer("Отменено")

        @command("menu", "keyboard")
        async def on_menu_show(message: Message) -> None:
            await self.bot.send_message(
                message.chat.id,
                "Клавиатура действий 👇",
                reply_markup=self._menu_keyboard(),
            )

        @command("hide", "close")
        async def on_menu_hide(message: Message) -> None:
            await self.bot.send_message(
                message.chat.id,
                "Клавиатура скрыта.",
                reply_markup=ReplyKeyboardRemove(),
            )

        @router.message(F.text)
        async def on_text(message: Message) -> None:
            text = (message.text or "").strip()
            if not text:
                await send_markdown(self.bot, message.chat.id, "Пока понимаю только текст 🙂")
                return
            if text.startswith("/"):
                await send_markdown(self.bot, message.chat.id, "Не знаю такую команду.")
                return
            chat_key = str(message.chat.id)
            if chat_key in self.running and not self.running[chat_key].done():
                await send_markdown(self.bot, message.chat.id, "Ещё работаю над прошлым запросом. Нажми «Стоп», чтобы прервать.")
                return
            task = asyncio.create_task(self._run_turn(message.chat.id, text))
            self.running[chat_key] = task
            task.add_done_callback(lambda _: self.running.pop(chat_key, None))

    # --- один ход

    async def _run_turn(self, chat_id: int, prompt: str) -> None:
        """Выполнить запрос и показать ответ."""
        chat = self.state.chat(chat_id)
        mode = chat.mode or self.cfg.backend
        streamer = Streamer(self.bot, chat_id)
        await streamer.open()
        self.streamers[chat_id] = streamer
        # Метка «ход идёт»: если процесс умрёт, на старте бот скажет «прервано».
        self.turn_started[str(chat_id)] = time.time()
        self.state.open_turn = {
            "chatId": chat_id,
            "messageId": streamer._message_id,
            "startedAt": time.time(),
            "prompt": prompt[:200],
        }
        self.state.save(force=True)

        try:
            if mode == "fast":
                self.state.stats["fastTurns"] = self.state.stats.get("fastTurns", 0) + 1
                result = await self._fast_turn(chat_id, chat, prompt, streamer)
            else:
                self.state.stats["agentTurns"] = self.state.stats.get("agentTurns", 0) + 1
                result = await self._agent_turn(chat, prompt, streamer)
        except asyncio.CancelledError:
            await self._clear_approvals(chat_id, "Ход остановлен.")
            await streamer.finish("Отменено.", "canceled")
            self.state.stats["messages"] = self.state.stats.get("messages", 0) + 1
            self.state.save(force=True)
            return
        except Exception as error:  # noqa: BLE001 — бот не должен падать
            log.exception("ход упал: %s", error)
            await self._clear_approvals(chat_id, "Ход остановлен.")
            self.state.stats["errors"] = self.state.stats.get("errors", 0) + 1
            await streamer.finish(f"Внутренняя ошибка: {error}", "error")
            self.state.save(force=True)
            return
        finally:
            # Ход закончился (или умер) — снимаем метку, чтобы на старте бот
            # не прислал ложное «прервано».
            if self._approvals.get(chat_id):
                await self._clear_approvals(chat_id, "Ход завершён.")
            self._approval_messages.pop(chat_id, None)
            self.streamers.pop(chat_id, None)
            self.turn_started.pop(str(chat_id), None)
            self.state.open_turn = None
            self.state.save(force=True)

        chat.updated_at = time.time()
        if getattr(result, "session_id", None):
            chat.session_id = result.session_id
        self.state.stats["messages"] = self.state.stats.get("messages", 0) + 1
        self.state.save(force=True)

        if result.aborted:
            await self._clear_approvals(chat_id, "Ход остановлен.")
            await streamer.finish("Отменено.", "canceled")
        elif result.error and not result.text:
            await self._clear_approvals(chat_id, "Ход остановлен.")
            self.state.stats["errors"] = self.state.stats.get("errors", 0) + 1
            await streamer.finish(result.error, "error")
        else:
            await streamer.finish(result.text)

    async def _agent_turn(self, chat: ChatState, prompt: str, streamer: Streamer):
        """Ход через DSH-агента на выбранной модели, усилии и правах."""
        if self.agent is None:
            from backends import TurnResult

            return TurnResult(error="dsh не найден: установи `npm i -g @deepseek-ai/dsh`")

        model = self._model_for(chat, "agent")
        effort = self._effort_for(chat)
        permission = self._permission_for(chat)

        def on_event(event: AgentEvent) -> None:
            if event.kind == "text":
                streamer.set_text(event.text)
            elif event.kind == "tool":
                streamer.add_log(event.label)

        result = await self.agent.run(
            prompt,
            session_id=chat.session_id,
            on_event=on_event,
            model=model,
            effort=effort,
            permission=permission,
        )

        def session_rejected(item) -> bool:
            blob = f"{item.error or ''} {item.text or ''}".lower()
            return any(word in blob for word in (
                "already in use",
                "уже использ",
                "session not found",
                "unknown session",
                "no such session",
                "session is locked",
            ))

        if chat.session_id and session_rejected(result):
            # Сессию держит другая копия DSH (dsh web / desktop): начинаем новую.
            log.warning("сессия агента занята другой копией DSH, создаю новую")
            chat.session_id = None
            result = await self.agent.run(
                prompt,
                session_id=None,
                on_event=on_event,
                model=model,
                effort=effort,
                permission=permission,
            )
        return result

    async def _fast_turn(self, chat_id: int, chat: ChatState, prompt: str, streamer: Streamer):
        """Ход через прямой DeepSeek API на выбранной модели."""
        model = self._model_for(chat, "fast")
        # Усилие отправляем только если его выбрали командой: по умолчанию
        # /fast не меняет поведение API.
        effort = chat.effort if chat.effort in EFFORTS else None
        key = str(chat_id)
        history = list(self.history.get(key, []))
        messages = [
            {"role": "system", "content": self.cfg.fast_system_prompt},
            *history,
            {"role": "user", "content": prompt},
        ]
        result = await run_chat(
            session=self.session,
            api_key=self.cfg.deepseek_api_key,
            model=model,
            messages=messages,
            max_tokens=self.cfg.fast_max_tokens,
            on_delta=streamer.append,
            reasoning_effort=effort,
        )
        if result.text and not result.error:
            history = [*history, {"role": "user", "content": prompt}, {"role": "assistant", "content": result.text}]
            while len(history) > self.cfg.max_history:
                history.pop(0)
            self.history[key] = history
        return result

    # --- разрешения

    @staticmethod
    def _approval_markup(item: ApprovalWaiter) -> InlineKeyboardMarkup:
        """Кнопки одного запроса разрешения."""
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text="✅ Разрешить", callback_data=f"approve:{item.id}"),
                    InlineKeyboardButton(text="❌ Отменить", callback_data=f"reject:{item.id}"),
                ]
            ]
        )

    @staticmethod
    def _approval_text(data: dict[str, Any]) -> str:
        """Текст запроса из approval/request: причина и инструмент."""
        tool = data.get("tool")
        reason = data.get("reason")
        display = data.get("displayReason")
        if not isinstance(reason, str) or not reason.strip():
            if isinstance(display, str):
                reason = display
            elif isinstance(display, dict):
                reason = display.get("ru") or display.get("en") or ""
        reason = (reason or "").strip()
        if len(reason) > 3000:
            reason = reason[:3000] + " …"
        lines = ["🔐 Нужно разрешение"]
        if isinstance(tool, str) and tool.strip():
            lines.append(f"Инструмент: {tool.strip()}")
        lines.append(reason or "Действие требует расширенных прав.")
        lines.append("Разрешить это действие?")
        return "\n\n".join(lines)

    async def _show_approval(self, chat_id: int, final_text: Optional[str] = None) -> None:
        """Показать первый запрос в очереди или итог в том же сообщении."""
        queue = self._approvals.get(chat_id) or []
        message_id = self._approval_messages.get(chat_id)
        if not queue:
            if message_id is not None:
                try:
                    await self.bot.edit_message_text(
                        text=final_text or "Ход завершён.",
                        chat_id=chat_id,
                        message_id=message_id,
                        reply_markup=InlineKeyboardMarkup(inline_keyboard=[]),
                    )
                except (TelegramBadRequest, TelegramNetworkError):
                    pass
                # Сам id не забываем: следующий запрос этого же хода должен
                # появиться в том же сообщении. Id снимается в конце хода.
            return
        item = queue[0]
        markup = self._approval_markup(item)
        if message_id is not None:
            try:
                await self.bot.edit_message_text(
                    text=item.text,
                    chat_id=chat_id,
                    message_id=message_id,
                    reply_markup=markup,
                )
                return
            except TelegramBadRequest as error:
                if "not modified" in error.message:
                    return
                log.warning("approval-сообщение не обновилось: %s", error.message)
            except TelegramNetworkError:
                return
        try:
            message = await self.bot.send_message(chat_id, item.text, reply_markup=markup)
            self._approval_messages[chat_id] = message.message_id
        except (TelegramBadRequest, TelegramNetworkError) as error:
            log.warning("не отправил approval-сообщение: %s", error)

    async def _resolve_approval(self, chat_id: int, request_id: str, allow: bool) -> bool:
        """Выдать/отклонить запрос и показать следующий в том же сообщении."""
        async with self._approval_lock:
            queue = self._approvals.get(chat_id) or []
            item = next((x for x in queue if x.id == request_id), None)
            if item is None:
                return False
            queue.remove(item)
            if not item.future.done():
                item.future.set_result("allowed-once" if allow else "rejected")
            if allow:
                await self._show_approval(
                    chat_id,
                    None if queue else "✅ Разрешения выданы — продолжаю.",
                )
            else:
                for rest in queue:
                    if not rest.future.done():
                        rest.future.set_result("cancelled")
                queue.clear()
                await self._show_approval(chat_id, "❌ Отменено — работа остановлена.")
            if not queue:
                self._approvals.pop(chat_id, None)
            return True

    async def _clear_approvals(self, chat_id: int, text: str) -> None:
        """Снять висящие запросы (ход отменён/упал) и закрыть сообщение."""
        async with self._approval_lock:
            queue = self._approvals.pop(chat_id, [])
            for item in queue:
                if not item.future.done():
                    item.future.set_result("cancelled")
            if queue or chat_id in self._approval_messages:
                await self._show_approval(chat_id, text)

    # --- панель и запуск

    async def start_panel(self) -> None:
        """Поднять маленькую страницу состояния."""
        if not self.cfg.http_enabled:
            return

        async def health(_: web.Request) -> web.Response:
            return web.json_response(
                {
                    "ok": True,
                    "uptimeSec": int(time.monotonic() - self.started_at),
                    "stats": self.state.stats,
                    "sessions": sum(1 for chat in self.state.chats.values() if chat.session_id),
                }
            )

        async def approval(request: web.Request) -> web.Response:
            """Запрос разрешения от DSH: ждём кнопку пользователя."""
            if request.headers.get("x-approval-token") != self._approval_token:
                return web.json_response({"outcome": "rejected"}, status=403)
            try:
                data = await request.json()
            except Exception:  # noqa: BLE001 — кривой запрос не должен вешать ход
                return web.json_response({"outcome": "rejected"}, status=400)
            if not isinstance(data, dict):
                return web.json_response({"outcome": "rejected"}, status=400)
            chat_id = self.state.owner_id
            if not chat_id:
                return web.json_response({"outcome": "unavailable"})

            loop = asyncio.get_running_loop()
            item = ApprovalWaiter(
                id=str(data.get("id") or f"a{time.time_ns()}"),
                chat_id=chat_id,
                text=self._approval_text(data),
                future=loop.create_future(),
            )
            async with self._approval_lock:
                self._approvals.setdefault(chat_id, []).append(item)
                await self._show_approval(chat_id)
            try:
                outcome = await item.future
            except asyncio.CancelledError:
                async with self._approval_lock:
                    queue = self._approvals.get(chat_id) or []
                    if item in queue:
                        queue.remove(item)
                    if not queue:
                        self._approvals.pop(chat_id, None)
                    await self._show_approval(chat_id, "Запрос снят.")
                raise
            return web.json_response({"outcome": outcome})

        async def index(_: web.Request) -> web.Response:
            minutes = int((time.monotonic() - self.started_at) // 60)
            rows = "".join(
                f"<tr><td>{key}</td><td>{chat.mode or self.cfg.backend}</td>"
                f"<td>{self._permission_for(chat)}</td>"
                f"<td>{chat.session_id or '—'}</td></tr>"
                for key, chat in self.state.chats.items()
            )
            html = f"""<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>telegram-bot</title>
<style>
:root{{color-scheme:dark}}
body{{margin:0;padding:20px;font:15px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e8ee}}
h1{{font-size:18px;margin:0 0 4px}}
.muted{{color:#8b93a7}}
.card{{background:#171a21;border:1px solid #242a35;border-radius:14px;padding:14px;margin:12px 0}}
table{{width:100%;border-collapse:collapse;font-size:13px}}
td{{padding:6px;border-bottom:1px solid #242a35;text-align:left}}
.dot{{display:inline-block;width:9px;height:9px;border-radius:50%;background:#22c55e;margin-right:6px}}
</style>
<h1><span class="dot"></span>@{self.cfg.bot_username or 'bot'}</h1>
<div class="muted">аптайм {minutes} мин · режим по умолчанию: {self.cfg.backend} ·
доступ по умолчанию: {self.cfg.default_permission}</div>
<div class="card">
  <div>сообщений: <b>{self.state.stats.get('messages', 0)}</b></div>
  <div>агент: <b>{self.state.stats.get('agentTurns', 0)}</b> ·
       быстрых: <b>{self.state.stats.get('fastTurns', 0)}</b> ·
       ошибок: <b>{self.state.stats.get('errors', 0)}</b></div>
</div>
<div class="card"><div class="muted">чаты</div>
<table>{rows or '<tr><td class="muted">пока пусто</td></tr>'}</table></div>"""
            return web.Response(text=html, content_type="text/html")

        app = web.Application()
        app.router.add_get("/health", health)
        app.router.add_post("/approval", approval)
        app.router.add_get("/", index)
        self._panel = web.AppRunner(app)
        await self._panel.setup()
        site = web.TCPSite(self._panel, self.cfg.http_host, self.cfg.http_port)
        try:
            await site.start()
            log.info("Telegram-бот активен")
        except OSError as error:
            log.warning("панель не поднялась (порт занят?): %s", error)

    async def _push_keyboard_update(self) -> None:
        """Один раз после смены раскладки заменить клавиатуру в известных чатах.

        Старые кнопки в клиенте живут до следующего сообщения с ``reply_markup``,
        поэтому после обновления кода важно сразу прислать новую клавиатуру.
        """
        if self.state.keyboard_version >= MENU_VERSION:
            return
        sent_ok = False
        for key in list(self.state.chats):
            try:
                await self.bot.send_message(
                    int(key),
                    "⌨️ Клавиатура обновлена.",
                    reply_markup=self._menu_keyboard(),
                )
                sent_ok = True
            except (TelegramAPIError, ValueError) as error:
                log.warning("не смог обновить клавиатуру в чате %s: %s", key, error)
        if sent_ok:
            self.state.keyboard_version = MENU_VERSION
            self.state.save(force=True)

    async def _publish_commands(self) -> None:
        """Убрать меню «/» в клиенте Telegram: команд в интерфейсе нет."""
        try:
            await self.bot.set_my_commands([])
            log.info("меню команд очищено")
        except (TelegramAPIError, ValueError) as error:
            log.warning("setMyCommands: %s", error)

    async def _announce_interrupted(self) -> None:
        """Сказать в чат, что прошлый ход оборвался перезапуском или падением."""
        turn = self.state.open_turn
        self.state.open_turn = None
        self.state.save(force=True)
        if not turn:
            return
        chat_id = turn.get("chatId")
        if not isinstance(chat_id, int):
            return
        started = float(turn.get("startedAt") or 0)
        elapsed = ""
        if started:
            seconds = max(0, int(time.time() - started))
            elapsed = f" · {seconds // 60}:{seconds % 60:02d}"
        note = f"Прервано{elapsed}\n\nПрошлый запрос оборвался: бот перезапускался. Повтори запрос."
        message_id = turn.get("messageId")
        if isinstance(message_id, int):
            try:
                await self.bot.edit_message_text(
                    text=note,
                    chat_id=chat_id,
                    message_id=message_id,
                )
                return
            except Exception as error:  # noqa: BLE001 — тогда отправим новым сообщением
                log.debug("не поправил зависшее сообщение: %s", error)
        try:
            await send_markdown(self.bot, chat_id, note)
        except Exception as error:  # noqa: BLE001 — уведомление не критично
            log.warning("не отправил уведомление о прерванном ходе: %s", error)

    async def run(self) -> None:
        """Старт: watchdog, панель, снятие вебхука, long polling."""
        self._restart_task = asyncio.create_task(self._watch_restart())
        await self.start_panel()
        try:
            await self.bot.delete_webhook(drop_pending_updates=False)
            log.info("вебхук снят, работаю на long polling")
        except TelegramNetworkError as error:
            log.warning("deleteWebhook: %s", error)
        await self._publish_commands()
        await self._push_keyboard_update()
        log.info("=== telegram-bot стартует ===")
        log.info("режим по умолчанию: %s; dsh: %s", self.cfg.backend, self.agent.bin_js if self.agent else "нет")
        if self.state.restart_notice:
            self.state.restart_notice = False
            self.state.save(force=True)
            await self._notify_owner("Бот обновлён.")
        await self._announce_interrupted()
        await self.dispatcher.start_polling(
            self.bot,
            allowed_updates=["message", "callback_query"],
        )

    async def close(self) -> None:
        """Аккуратно всё закрыть."""
        if self._panel is not None:
            await self._panel.cleanup()
        if self.session is not None:
            await self.session.close()
        await self.bot.session.close()
        self.state.save(force=True)


# ─────────────────────────────────────────── самопроверки


async def check(cfg: Config) -> bool:
    """Проверить конфиг, токен и наличие dsh."""
    problems: list[str] = []
    if not cfg.bot_token or ":" not in cfg.bot_token:
        problems.append("botToken не похож на токен")
    if not cfg.deepseek_api_key:
        problems.append("deepseekApiKey пустой")
    if resolve_dsh_bin() is None:
        problems.append("dsh не найден (нужен для режима агента)")
    if not Path(cfg.dsh_cwd).is_dir():
        problems.append(f"dshCwd не существует: {cfg.dsh_cwd}")

    bot = Bot(token=cfg.bot_token, session=make_telegram_session(cfg.proxy))
    try:
        me = await bot.get_me()
        print(f"бот: @{me.username} (id {me.id})")
    except Exception as error:  # noqa: BLE001
        problems.append(f"getMe: {error}")
        print("бот: не ответил")
    finally:
        await bot.session.close()

    print(f"конфиг: {CONFIG_PATH}")
    print(f"dsh: {resolve_dsh_bin() or 'НЕ НАЙДЕН'}")
    print(f"рабочая папка агента: {cfg.dsh_cwd}")
    print(f"модель агента: {cfg.agent_model}, усилие: {cfg.agent_reasoning_effort}")
    print(f"доступ агента по умолчанию: {cfg.default_permission}")
    print("проблемы:\n - " + "\n - ".join(problems) if problems else "problems: нет")
    return not problems


async def selftest(cfg: Config) -> None:
    """Прогнать оба «мозга» по одному разу."""
    print("\n— быстрый режим —")
    async with make_session(cfg.proxy) as session:
        streamed: list[str] = []
        result = await run_chat(
            session=session,
            api_key=cfg.deepseek_api_key,
            model=cfg.fast_model,
            messages=[{"role": "user", "content": "Ответь одним словом: пинг"}],
            max_tokens=64,
            on_delta=streamed.append,
        )
    print("результат:", result.error or repr(result.text), f"(поток: {len(streamed)} кусков)")

    print("\n— режим агента —")
    bin_js = resolve_dsh_bin()
    if bin_js is None:
        print("dsh не найден")
        return
    runner = AgentRunner(
        bin_js=bin_js,
        cwd=Path(cfg.dsh_cwd),
        dsh_home=Path(cfg.dsh_home) if cfg.dsh_home else None,
        profile=cfg.dsh_profile,
        timeout=cfg.agent_timeout_ms / 1000,
        patch_dir=PATCH_DIR,
    )
    tools: list[str] = []
    result = await runner.run(
        "Ответь одним словом: понг",
        on_event=lambda event: tools.append(event.label) if event.kind == "tool" else None,
        model=cfg.agent_model,
        effort=cfg.agent_reasoning_effort,
    )
    print("результат:", result.error or repr(result.text))
    print("сессия:", result.session_id or "—", "| инструментов:", len(tools))


async def main() -> None:
    parser = argparse.ArgumentParser(description="Telegram-бот к DeepSeek на aiogram 3")
    parser.add_argument("--check", action="store_true", help="проверить конфиг и токен")
    parser.add_argument("--selftest", action="store_true", help="прогнать оба режима по разу")
    parser.add_argument("--verbose", action="store_true", help="подробный лог")
    args = parser.parse_args()

    setup_logging(args.verbose)
    cfg = load_config()

    if args.check:
        ok = await check(cfg)
        sys.exit(0 if ok else 1)
    if args.selftest:
        await check(cfg)
        await selftest(cfg)
        return

    lock = acquire_single_instance()
    if lock is None:
        # Второй экземпляр не нужен: он только отнимал бы обновления у первого.
        # Код 0 — супервизор не должен поднимать его снова.
        log.warning("бот уже запущен (%s занят) — выхожу", LOCK_PATH)
        return

    bridge = Bridge(cfg)
    try:
        await bridge.run()
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        await bridge.close()
        lock.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
