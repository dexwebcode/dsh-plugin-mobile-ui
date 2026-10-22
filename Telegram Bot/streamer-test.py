"""streamer-test.py — проверка живого сообщения и итоговой правки.

Гоняет :class:`bot.Streamer` без Telegram: бот подменён сборщиком вызовов.
Карточка действий сейчас отключена (``Streamer._card_lines`` возвращает пусто),
поэтому проверяется, что

* живая правка идёт HTML-ом, показывает «DeepSeek Thinking · 0:05» и
  экранирует текст ответа, но не рисует карточку;
* итоговая правка — MarkdownV2 со статусом «Готово» и текстом ответа.
"""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

BOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BOT))

import bot as B  # noqa: E402


class FakeBot:
    """Записывает вызовы вместо отправки в Telegram."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.edits: list[dict] = []

    async def send_message(self, chat_id, text, **kwargs):
        self.sent.append({"chat_id": chat_id, "text": text, **kwargs})
        return SimpleNamespace(message_id=100 + len(self.sent))

    async def edit_message_text(self, **kwargs):
        self.edits.append(kwargs)

    async def send_chat_action(self, chat_id, action):
        return None


async def main() -> int:
    failures: list[str] = []

    def check(name: str, condition: bool, view: str = "") -> None:
        print(("OK   " if condition else "FAIL ") + name)
        if not condition:
            print("     " + view.replace("\n", "\\n")[:500])
            failures.append(name)

    bot = FakeBot()
    streamer = B.Streamer(bot, 42)
    await streamer.open()

    ops = [
        "🔧 pwsh: Get-ChildItem -File",
        "🔧 glob: *.py",
        "🔧 read: bot.py",
        "🔧 pwsh: python -m py_compile bot.py",
        "🔧 pwsh: Set-Content -Path 'C:\\a.txt' -Value 'ok'",
        "🔧 pwsh: Get-Content -Path 'C:\\a.txt'",
        "🔧 pwsh: node bin.js headless --json -",
    ]
    for op in ops:
        streamer.add_log(op)
        await asyncio.sleep(0.05)
    streamer.set_text("Пишу **ответ** и код `print(1)` <b>не тег</b>")

    await asyncio.sleep(B.REFRESH_INTERVAL + 0.4)  # дать тикеру один тик

    check(
        "потоковая правка идёт в HTML",
        any(e.get("parse_mode") == B.ParseMode.HTML for e in bot.edits),
        str(bot.edits[-1:] if bot.edits else "нет правок"),
    )
    live = next(
        (e["text"] for e in reversed(bot.edits) if e.get("parse_mode") == B.ParseMode.HTML),
        "",
    )
    check("в живом сообщении заголовок с таймером", live.startswith("DeepSeek Thinking · 0:"), live)
    check("карточка действий не рисуется", "<pre>" not in live and "pwsh" not in live, live)
    check("текст ответа экранирован", "&lt;b&gt;не тег&lt;/b&gt;" in live, live)
    check("текст ответа виден в живом сообщении", "Пишу **ответ**" in live, live)

    await streamer.finish("**Готово**: файл записан.\n\n```\nprint(1)\n```")

    final = bot.edits[-1]
    text = final["text"]
    check("итог — MarkdownV2", final.get("parse_mode") == B.ParseMode.MARKDOWN_V2, text)
    check("итог начинается статусом «Готово»", text.startswith("Готово\n\n"), text)
    check("в итоге нет карточки", "<pre>" not in text and "```\n┌" not in text, text)
    check("ответ отформатирован", "*Готово*" in text, text)
    check("код из ответа не потерялся", "print(1)" in text, text)

    if failures:
        print("\nFAILURES:", failures)
        return 1
    print("\nвсе проверки прошли")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
