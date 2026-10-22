"""Прогон команд прав и нижней клавиатуры через настоящий aiogram-роутер.

Сообщения не уходят в Telegram: ``send_message`` подменяется сборщиком текста, а
состояние пишется во временную копию ``state.json``, чтобы не трогать живой файл.
Настоящий ход агента не запускается: тест нажимает только кнопки и команды.
"""

import asyncio
import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

BOT = Path(r"C:\Users\AVA\Documents\deepseek-harness\default-workspace\dsh-plugin-mobile-ui\Telegram Bot")
sys.path.insert(0, str(BOT))

import bot as B  # noqa: E402
from aiogram.types import Chat, Message, Update, User  # noqa: E402

OWNER = 1112634401
sent: list[str] = []
markups: list = []


async def fake_send(chat_id, text, **kwargs):
    sent.append(text)
    markups.append(kwargs.get("reply_markup"))
    return object()


def make_message(text: str) -> Message:
    return Message(
        message_id=len(sent) + 1,
        date=datetime.now(timezone.utc),
        chat=Chat(id=OWNER, type="private"),
        from_user=User(id=OWNER, is_bot=False, first_name="AVA", username="ava"),
        text=text,
    )


async def send(dispatcher, bot, text: str) -> str:
    before = len(sent)
    await dispatcher.feed_update(bot, Update(update_id=before + 1, message=make_message(text)))
    return "\n".join(sent[before:])


def inline_callbacks(markup) -> set[str]:
    if markup is None or getattr(markup, "inline_keyboard", None) is None:
        return set()
    return {button.callback_data for row in markup.inline_keyboard for button in row}


def keyboard_labels(markup) -> list[str]:
    if markup is None or getattr(markup, "keyboard", None) is None:
        return []
    return [button.text for row in markup.keyboard for button in row]


async def main() -> int:
    tmp = Path(tempfile.gettempdir()) / "bot-state-commands-test.json"
    shutil.copyfile(BOT / "state.json", tmp)
    B.STATE_PATH = tmp

    cfg = B.load_config()
    bridge = B.Bridge(cfg)
    bridge.bot.send_message = fake_send  # type: ignore[method-assign]

    failures: list[str] = []

    def check(name: str, condition: bool, reply: str) -> None:
        print(("OK   " if condition else "FAIL ") + name)
        if not condition:
            print("     reply:", reply.replace("\n", " | ")[:400])
            failures.append(name)

    def chat_state() -> dict:
        return json.loads(tmp.read_text(encoding="utf-8"))["chats"][str(OWNER)]

    reply = await send(bridge.dispatcher, bridge.bot, "/permission")
    check(
        "/permission показывает текущий доступ и как менять",
        "Доступ агента" in reply and "Сменить" in reply,
        reply,
    )

    reply = await send(bridge.dispatcher, bridge.bot, "/read")
    check(
        "/read включает только чтение",
        "только чтение" in reply and chat_state()["permission"] == "read-only",
        reply,
    )

    reply = await send(bridge.dispatcher, bridge.bot, "/permission workspace")
    check(
        "/permission workspace включает запись в папку",
        chat_state()["permission"] == "workspace-write",
        reply,
    )

    reply = await send(bridge.dispatcher, bridge.bot, "/full")
    check(
        "/full возвращает полный доступ",
        "полный доступ" in reply and chat_state()["permission"] == "danger-full-access",
        reply,
    )
    check("смена прав сбрасывает сессию", chat_state()["sessionId"] is None, reply)

    reply = await send(bridge.dispatcher, bridge.bot, "/permission wat")
    check("неизвестное имя отклоняется", "Не знаю такой доступ" in reply, reply)

    reply = await send(bridge.dispatcher, bridge.bot, "/status")
    check(
        "/status показывает доступ",
        "доступ" in reply and "полный доступ" in reply,
        reply,
    )

    reply = await send(bridge.dispatcher, bridge.bot, "/help")
    check(
        "/help не перечисляет команды",
        "/full" not in reply and "/permission" not in reply,
        reply,
    )
    check(
        "/help присылает клавиатуру из 5 кнопок",
        keyboard_labels(markups[-1]) == [
            "Модель",
            "Доступ",
            "Новая сессия",
            "Статус",
            "Обновить",
        ],
        reply,
    )

    # --- нижняя клавиатура открывает панели, а не общий пульт
    reply = await send(bridge.dispatcher, bridge.bot, "Модель")
    callbacks = inline_callbacks(markups[-1])
    check(
        "кнопка «Модель» открывает панель модели",
        f"pick:model:{B.MODEL_FLASH}" in callbacks
        and f"pick:model:{B.MODEL_PRO}" in callbacks
        and "ui:close" in callbacks,
        reply,
    )
    reply = await send(bridge.dispatcher, bridge.bot, "Доступ")
    callbacks = inline_callbacks(markups[-1])
    check(
        "кнопка «Доступ» открывает варианты прав",
        "pick:access:danger-full-access" in callbacks
        and "pick:access:read-only" in callbacks
        and "ui:close" in callbacks,
        reply,
    )

    # --- старая подпись «Усилие» из прошлой раскладки ещё работает
    reply = await send(bridge.dispatcher, bridge.bot, "Усилие")
    callbacks = inline_callbacks(markups[-1])
    check(
        "устаревшая кнопка «Усилие» открывает панель усилия",
        {"pick:effort:low", "pick:effort:high", "pick:effort:max"} <= callbacks,
        reply,
    )

    await bridge._pick_option(OWNER, "access", "danger-full-access")
    check(
        "выбор «Полный» в панели даёт полный доступ",
        chat_state()["permission"] == "danger-full-access",
        "",
    )

    # --- «Новая сессия» сбрасывает контекст и не запускает агента
    reply = await send(bridge.dispatcher, bridge.bot, "Новая сессия")
    check(
        "кнопка «Новая сессия» сбрасывает контекст",
        "Контекст сброшен" in reply and chat_state()["sessionId"] is None,
        reply,
    )

    # --- «Обновить» перезапускает бота, чтобы подхватить новый код
    restarts: list[str] = []

    async def fake_restart(reason: str = "обновление", wait_for_turns: bool = True) -> None:
        restarts.append(reason)

    bridge._begin_restart = fake_restart  # type: ignore[method-assign]
    reply = await send(bridge.dispatcher, bridge.bot, "Обновить")
    check(
        "кнопка «Обновить» перезапускает бота",
        restarts == ["обновление бота"],
        reply,
    )

    # --- /menu показывает только нижнюю клавиатуру, без inline-панели
    before = len(sent)
    reply = await send(bridge.dispatcher, bridge.bot, "/menu")
    new_markups = markups[before:]
    check(
        "/menu показывает клавиатуру и не открывает панель",
        len(new_markups) == 1
        and isinstance(new_markups[0], B.ReplyKeyboardMarkup)
        and len(keyboard_labels(new_markups[0])) == 5,
        reply,
    )

    await bridge.close()
    tmp.unlink(missing_ok=True)
    print("\nmessages sent:", len(sent))
    if failures:
        print("FAILURES:", failures)
        return 1
    print("все проверки прошли")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
