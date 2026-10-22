"""Проверка нижней клавиатуры и inline-панелей без сети.

Бот не ходит в Telegram: ``send_message`` подменяется сборщиком текста и
разметки, состояние пишется во временную копию ``state.json``, а
``defaultPermission`` — во временную копию ``config.json``.

Что проверяем:

* нижняя клавиатура: 3 ряда / 5 кнопок, уникальные подписи, что каждая кнопка
  описана в :data:`bot.MENU_ACTIONS` и что нажатие каждой кнопки через
  настоящий aiogram-роутер что-то делает;
* в панелях нет общей навигации: ни «Назад», ни пульта «Все команды» —
  каждая панель живёт сама и внизу имеет «Закрыть панель»;
* выбор модели ведёт в панель усилия, выбор усилия закрывает панель, выбор
  доступа оставляет панель на месте;
* «Закрыть панель» удаляет сообщение панели.
"""

import asyncio
import json
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

BOT = Path(r"C:\Users\AVA\Documents\deepseek-harness\default-workspace\dsh-plugin-mobile-ui\Telegram Bot")
sys.path.insert(0, str(BOT))

import bot as B  # noqa: E402
from aiogram.types import CallbackQuery, Chat, Message, Update, User  # noqa: E402

OWNER = 1112634401
CLOSE_TEXT = "✖️ Закрыть панель"
sent: list[str] = []
markups: list = []
edited: list[tuple[str, object]] = []
deleted: list[int] = []
answers: list[str | None] = []


async def fake_send(chat_id, text, **kwargs):
    sent.append(text)
    markups.append(kwargs.get("reply_markup"))
    return SimpleNamespace(message_id=len(sent))


class FakeCallback:
    """Минимальная замена CallbackQuery для проверки _ui_action."""

    def __init__(self) -> None:
        self.from_user = SimpleNamespace(id=OWNER)
        self.message = SimpleNamespace(
            chat=SimpleNamespace(id=OWNER),
            edit_text=self._edit_text,
            delete=self._delete,
        )
        self.edited: list[tuple[str, object]] = []
        self.deleted: list[int] = []

    async def _edit_text(self, text, reply_markup=None):
        self.edited.append((text, reply_markup))

    async def _delete(self):
        self.deleted.append(1)


def callbacks(markup) -> list[str]:
    if markup is None:
        return []
    return [button.callback_data for row in markup.inline_keyboard for button in row]


def texts(markup) -> list[str]:
    if markup is None:
        return []
    return [button.text for row in markup.inline_keyboard for button in row]


def rows(markup) -> list[list]:
    return [list(row) for row in markup.inline_keyboard]


def labels(markup) -> list[str]:
    return [button.text for row in markup.keyboard for button in row]


def make_message(text: str) -> Message:
    return Message(
        message_id=len(sent) + 1,
        date=datetime.now(timezone.utc),
        chat=Chat(id=OWNER, type="private"),
        from_user=User(id=OWNER, is_bot=False, first_name="AVA", username="ava"),
        text=text,
    )


def make_callback(data: str, text: str = "⚙️ Модель") -> CallbackQuery:
    message = Message(
        message_id=500,
        date=datetime.now(timezone.utc),
        chat=Chat(id=OWNER, type="private"),
        from_user=User(id=OWNER, is_bot=False, first_name="AVA"),
        text=text,
    )
    return CallbackQuery(
        id=f"cb-{data}",
        from_user=User(id=OWNER, is_bot=False, first_name="AVA"),
        chat_instance="test",
        message=message,
        data=data,
    )


def is_close_row(markup) -> bool:
    """Последний ряд панели — одна кнопка «Закрыть панель»."""
    last = rows(markup)[-1]
    return len(last) == 1 and last[0].text == CLOSE_TEXT and last[0].callback_data == "ui:close"


def option(markup, callback: str):
    for row in markup.inline_keyboard:
        for button in row:
            if button.callback_data == callback:
                return button
    return None


async def main() -> int:
    tmp_state = Path(tempfile.gettempdir()) / "bot-state-keyboard-test.json"
    tmp_config = Path(tempfile.gettempdir()) / "bot-config-keyboard-test.json"
    tmp_lock = Path(tempfile.gettempdir()) / "bot-lock-keyboard-test.lock"
    shutil.copyfile(BOT / "state.json", tmp_state)
    shutil.copyfile(BOT / "config.json", tmp_config)
    B.STATE_PATH = tmp_state
    B.CONFIG_PATH = tmp_config
    # Живой бот держит свой замок: проверяем единственность на отдельном файле,
    # иначе тест зависел бы от того, запущен ли бот прямо сейчас.
    B.LOCK_PATH = tmp_lock
    B.PATCH_DIR = tmp_lock.parent

    cfg = B.load_config()
    bridge = B.Bridge(cfg)
    bridge.bot.send_message = fake_send  # type: ignore[method-assign]

    failures: list[str] = []
    checks = 0

    def check(name: str, condition: bool, detail: str = "") -> None:
        nonlocal checks
        checks += 1
        print(("OK   " if condition else "FAIL ") + name)
        if not condition:
            print("     ", str(detail)[:500])
            failures.append(name)

    def state() -> dict:
        return json.loads(tmp_state.read_text(encoding="utf-8"))

    # --- нижняя клавиатура: 5 кнопок, без пульта «Все команды»
    keyboard = bridge._menu_keyboard()
    rows_ = keyboard.keyboard
    check("клавиатура компактная: 3 ряда", len(rows_) == 3, str(len(rows_)))
    check("на клавиатуре 5 кнопок", sum(len(row) for row in rows_) == 5, str(labels(keyboard)))
    check("подписи кнопок не повторяются", len(set(labels(keyboard))) == 5, str(labels(keyboard)))
    check(
        "все подписи клавиатуры описаны в MENU_ACTIONS",
        set(labels(keyboard)) == set(B.MENU_ACTIONS),
        str(set(labels(keyboard)) ^ set(B.MENU_ACTIONS)),
    )
    check(
        "на клавиатуре нет общего пульта",
        all("ui:main" not in action for action in B.MENU_ACTIONS.values())
        and all("☰" not in label for label in labels(keyboard)),
        str(B.MENU_ROWS),
    )
    check(
        "все команды клавиатуры зарегистрированы",
        all(
            action.split()[0] in bridge._command_handlers
            for action in B.MENU_ACTIONS.values()
            if action.startswith("/")
        ),
        str([a for a in B.MENU_ACTIONS.values() if a.startswith("/")]),
    )
    check(
        "все разделы клавиатуры есть в панели",
        all(
            action.split(":", 1)[1] in {"model", "effort", "access", "default"}
            for action in B.MENU_ACTIONS.values()
            if action.startswith("ui:")
        ),
        str([a for a in B.MENU_ACTIONS.values() if a.startswith("ui:")]),
    )

    # --- каждая кнопка нижней клавиатуры нажимается и что-то делает
    # «Обновить» перезапускает бота — здесь только фиксируем сам вызов.
    restart_calls: list[str] = []

    async def fake_restart(reason: str = "обновление", wait_for_turns: bool = True) -> None:
        restart_calls.append(reason)

    bridge._begin_restart = fake_restart  # type: ignore[method-assign]

    for label in labels(keyboard):
        before = len(sent)
        try:
            await bridge.dispatcher.feed_update(
                bridge.bot, Update(update_id=len(sent) + 1, message=make_message(label))
            )
        except Exception as error:  # noqa: BLE001 — падение кнопки и есть провал
            check(f"кнопка «{label}» нажимается", False, repr(error))
            continue
        check(
            f"кнопка «{label}» нажимается",
            len(sent) > before or markups[-1] is not None or (label == "Обновить" and restart_calls),
            "кнопка ничего не прислала и не перезапустила бота",
        )

    check(
        "кнопка «Обновить» перезапускает бота",
        B.MENU_ACTIONS.get("Обновить") == "/update" and restart_calls == ["обновление бота"],
        f"action={B.MENU_ACTIONS.get('Обновить')} restarts={restart_calls}",
    )
    check(
        "старая кнопка «🔄 Обновить» тоже перезапускает",
        B.LEGACY_MENU_ACTIONS.get("🔄 Обновить") == "/update",
        str(B.LEGACY_MENU_ACTIONS.get("🔄 Обновить")),
    )

    # --- панели: каждая сама по себе, без «Назад» и общего пульта
    views = {
        "model": bridge._section_view("model", OWNER),
        "effort": bridge._section_view("effort", OWNER),
        "access": bridge._section_view("access", OWNER),
        "default": bridge._section_view("default", OWNER),
    }
    for section, (text, markup) in views.items():
        panel_callbacks = callbacks(markup)
        check(
            f"панель «{section}»: внизу «Закрыть панель»",
            is_close_row(markup),
            str(rows(markup)),
        )
        check(
            f"панель «{section}»: нет «Назад»",
            not any("назад" in button.text.lower() for button in sum(rows(markup), [])),
            str(texts(markup)),
        )
        check(
            f"панель «{section}»: только свои кнопки",
            all(
                data == "ui:close"
                or data.startswith("pick:")
                or data == "ui:default"
                for data in panel_callbacks
            ),
            str(panel_callbacks),
        )

    text, model_markup = views["model"]
    check(
        "раздел «Модель»: Flash и Pro",
        f"pick:model:{B.MODEL_FLASH}" in callbacks(model_markup)
        and f"pick:model:{B.MODEL_PRO}" in callbacks(model_markup),
        str(callbacks(model_markup)),
    )
    check(
        "текущая модель помечена точкой",
        option(model_markup, f"pick:model:{B.MODEL_FLASH}").text.startswith("• ")
        or option(model_markup, f"pick:model:{B.MODEL_PRO}").text.startswith("• "),
        str(texts(model_markup)),
    )
    check(
        "в панели модели нет панели усилия",
        "pick:effort:low" not in callbacks(model_markup),
        str(callbacks(model_markup)),
    )

    text, effort_markup = views["effort"]
    check(
        "раздел «Усилие»: low/high/max",
        {"pick:effort:low", "pick:effort:high", "pick:effort:max"} <= set(callbacks(effort_markup)),
        str(callbacks(effort_markup)),
    )
    check(
        "из усилия нельзя вернуться к модели",
        "pick:model:" + B.MODEL_FLASH not in callbacks(effort_markup),
        str(callbacks(effort_markup)),
    )

    text, access_markup = views["access"]
    check(
        "раздел «Доступ»: три пресета и умолчание",
        {
            "pick:access:danger-full-access",
            "pick:access:workspace-write",
            "pick:access:read-only",
            "ui:default",
        }
        <= set(callbacks(access_markup)),
        str(callbacks(access_markup)),
    )
    check(
        "в доступе «Закрыть панель» — нижняя кнопка",
        callbacks(access_markup)[-1] == "ui:close",
        str(callbacks(access_markup)),
    )

    text, default_markup = views["default"]
    check(
        "раздел «Умолчание»: три пресета",
        {
            "pick:default:danger-full-access",
            "pick:default:workspace-write",
            "pick:default:read-only",
        }
        <= set(callbacks(default_markup)),
        str(callbacks(default_markup)),
    )

    # --- общего пульта больше нет: неизвестный раздел падает в «Модель»
    check(
        "panel_of не знает общий пульт",
        bridge.panel_of("☰ Все команды\nрежим: agent") == ""
        and bridge.panel_of("⚙️ Модель\nСейчас: deepseek-flash") == "model"
        and bridge.panel_of("🎚 Усилие рассуждений\nСейчас: high") == "effort"
        and bridge.panel_of("🔐 Доступ агента\nСейчас: …") == "access"
        and bridge.panel_of("⚙️ Доступ по умолчанию\n…") == "default"
        and bridge.panel_of(None) == "",
        "",
    )
    fallback_text, fallback_markup = bridge._section_view("main", OWNER)
    check(
        "неизвестный раздел показывается как «Модель»",
        fallback_text.startswith("⚙️ Модель") and is_close_row(fallback_markup),
        fallback_text,
    )

    # --- выбор вариантов меняет состояние и не спамит сообщениями
    before = len(sent)
    toast = await bridge._pick_option(OWNER, "mode", "fast")
    check(
        "выбор «Быстрый» включает режим fast",
        state()["chats"][str(OWNER)]["mode"] == "fast" and toast == "Режим: fast",
        str(toast),
    )
    toast = await bridge._pick_option(OWNER, "model", B.MODEL_PRO)
    check(
        "выбор Pro меняет модель чата",
        state()["chats"][str(OWNER)]["model"] == B.MODEL_PRO and toast == f"Модель: {B.MODEL_PRO}",
        str(toast),
    )
    toast = await bridge._pick_option(OWNER, "effort", "max")
    check(
        "выбор Max меняет усилие чата",
        state()["chats"][str(OWNER)]["effort"] == "max" and toast == "Усилие: max",
        str(toast),
    )
    toast = await bridge._pick_option(OWNER, "access", "read-only")
    check(
        "выбор «Чтение» меняет права и сбрасывает сессию",
        state()["chats"][str(OWNER)]["permission"] == "read-only"
        and state()["chats"][str(OWNER)]["sessionId"] is None,
        str(toast),
    )
    toast = await bridge._pick_option(OWNER, "default", "workspace-write")
    check(
        "выбор умолчания пишется в config.json",
        json.loads(tmp_config.read_text(encoding="utf-8"))["defaultPermission"] == "workspace-write",
        str(toast),
    )
    check(
        "выбор в панели не присылает лишних сообщений",
        len(sent) == before,
        f"прислано {len(sent) - before} сообщений",
    )
    check(
        "устаревшая кнопка не применяется",
        await bridge._pick_option(OWNER, "model", "нет-такой") is None,
        "",
    )

    # --- callback-кнопки через настоящий aiogram-роутер
    async def fake_edit(self, text, **kwargs):
        edited.append((text, kwargs.get("reply_markup")))

    async def fake_delete(self, **kwargs):
        deleted.append(self.message_id)

    async def fake_answer(self, text=None, **kwargs):
        answers.append(text)

    B.Message.edit_text = fake_edit  # type: ignore[method-assign]
    B.Message.delete = fake_delete  # type: ignore[method-assign]
    B.CallbackQuery.answer = fake_answer  # type: ignore[method-assign]

    await bridge.dispatcher.feed_update(
        bridge.bot, Update(update_id=9001, callback_query=make_callback("ui:model"))
    )
    check(
        "callback ui:model открывает раздел «Модель»",
        bool(edited) and "Модель" in edited[-1][0] and answers[-1] in (None, ""),
        str(edited[-1:] or answers[-1:]),
    )

    edited.clear()
    await bridge.dispatcher.feed_update(
        bridge.bot,
        Update(
            update_id=9002,
            callback_query=make_callback(
                f"pick:model:{B.MODEL_PRO}", "⚙️ Модель\nСейчас: deepseek-flash"
            ),
        ),
    )
    check(
        "выбор модели открывает усилие, а не «Назад»",
        bool(edited)
        and edited[-1][0].startswith("🎚 Усилие")
        and "Модель:" in edited[-1][0]
        and is_close_row(edited[-1][1]),
        str(edited[-1:][0][0] if edited else ""),
    )

    edited.clear()
    deleted.clear()
    await bridge.dispatcher.feed_update(
        bridge.bot,
        Update(update_id=9003, callback_query=make_callback("pick:effort:max", "🎚 Усилие рассуждений\nСейчас: high")),
    )
    check(
        "выбор усилия меняет его и закрывает панель",
        state()["chats"][str(OWNER)]["effort"] == "max"
        and answers[-1] == "Усилие: max"
        and not edited
        and bool(deleted),
        f"edited={edited[-1:]} deleted={deleted} answers={answers[-1:]}",
    )

    edited.clear()
    await bridge.dispatcher.feed_update(
        bridge.bot,
        Update(
            update_id=9004,
            callback_query=make_callback(
                "pick:access:workspace-write", "🔐 Доступ агента\nСейчас: только чтение"
            ),
        ),
    )
    check(
        "выбор доступа остаётся в панели и ставит точку",
        state()["chats"][str(OWNER)]["permission"] == "workspace-write"
        and bool(edited)
        and edited[-1][0].startswith("🔐 Доступ агента")
        and option(edited[-1][1], "pick:access:workspace-write").text.startswith("• ")
        and is_close_row(edited[-1][1]),
        str(edited[-1:][0][0] if edited else ""),
    )

    edited.clear()
    await bridge.dispatcher.feed_update(
        bridge.bot,
        Update(
            update_id=9005,
            callback_query=make_callback("pick:default:workspace-write", "⚙️ Доступ по умолчанию\n…"),
        ),
    )
    check(
        "выбор умолчания остаётся в своей панели",
        bool(edited)
        and edited[-1][0].startswith("⚙️ Доступ по умолчанию")
        and is_close_row(edited[-1][1]),
        str(edited[-1:][0][0] if edited else ""),
    )

    # --- «Закрыть панель» удаляет сообщение панели
    deleted.clear()
    await bridge.dispatcher.feed_update(
        bridge.bot, Update(update_id=9006, callback_query=make_callback("ui:close"))
    )
    check("«Закрыть панель» удаляет панель", bool(deleted), str(deleted))

    callback = FakeCallback()
    toast = await bridge._ui_action(callback, "model")
    check("кнопка раздела обновляет панель", toast is None and bool(callback.edited), str(toast))

    # --- единственный экземпляр
    first = B.acquire_single_instance()
    second = B.acquire_single_instance()
    check("второй экземпляр не отбирает обновления", first is not None and second is None, "")
    if first is not None:
        first.close()

    await bridge.close()
    tmp_state.unlink(missing_ok=True)
    tmp_config.unlink(missing_ok=True)
    tmp_lock.unlink(missing_ok=True)
    print("\nпроверок:", checks)
    if failures:
        print("FAILURES:", failures)
        return 1
    print("все проверки прошли")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
