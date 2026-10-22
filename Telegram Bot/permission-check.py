"""permission-check.py — проверка прав агента на живом ``dsh headless``.

Скрипт делает один настоящий ход агента с выбранными правами и просит записать
файл **вне** рабочей папки:

* ``danger-full-access`` — файл появляется (полный доступ, подтверждений нет);
* ``read-only`` — файл не появляется, агент объясняет отказ.

Запуск (как и бот — базовым python с пакетами из venv):

    $bot = 'C:\\Users\\AVA\\Documents\\deepseek-harness\\default-workspace\\dsh-plugin-mobile-ui\\Telegram Bot'
    $env:PYTHONPATH = "$bot\\.venv\\Lib\\site-packages"
    & 'C:\\Users\\AVA\\AppData\\Roaming\\uv\\python\\cpython-3.12-windows-x86_64-none\\python.exe' `
        "$bot\\permission-check.py" danger-full-access

Без аргумента проверяются права по умолчанию (:data:`backends.DEFAULT_PERMISSION`).
Каждый запуск — это один запрос к модели, поэтому проверяют по необходимости.
"""

import asyncio
import os
import sys
from pathlib import Path

BOT = Path(__file__).resolve().parent
sys.path.insert(0, str(BOT))

from backends import AgentRunner, DEFAULT_PERMISSION, resolve_dsh_bin  # noqa: E402

#: Файл-проба вне рабочей папки: в песочнице ``workspace-write`` туда писать нельзя.
PROBE = Path.home() / "dsh-perm-probe.txt"

PROMPT = (
    f"Через инструмент pwsh запиши в файл {PROBE} текст ok. "
    "Ничего не объясняй, ответь одним словом: готово."
)


async def main() -> int:
    permission = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PERMISSION
    if PROBE.exists():
        PROBE.unlink()
    bin_js = resolve_dsh_bin()
    if bin_js is None:
        print("dsh не найден: установи `npm i -g @deepseek-ai/dsh`")
        return 1
    runner = AgentRunner(
        bin_js=bin_js,
        cwd=Path(r"C:\Users\AVA\Documents\deepseek-harness\default-workspace"),
        dsh_home=Path(r"C:\Users\AVA\.dsh"),
        profile="headless",
        timeout=240.0,
        patch_dir=BOT / ".runtime",
        permission=permission,
    )
    tools: list[str] = []
    result = await runner.run(
        PROMPT,
        on_event=lambda event: tools.append(event.label) if event.kind == "tool" else None,
        permission=permission,
    )
    print("permission:", permission)
    print("tools:", tools)
    print("error:", result.error)
    print("text:", (result.text or "")[:300])
    print("session:", result.session_id)
    print("probe exists:", PROBE.exists(), "| content:", PROBE.read_text(encoding="utf-8") if PROBE.exists() else "-")
    return 0


if __name__ == "__main__":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    raise SystemExit(asyncio.run(main()))
