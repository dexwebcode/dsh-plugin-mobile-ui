"""backends.py — два «мозга» бота.

* :class:`AgentRunner` — твой DSH-агент: ``dsh headless --json`` в отдельном
  процессе, с инструментами, рабочей папкой и сессиями (как в веб-интерфейсе).
* :func:`run_chat` — прямой запрос к DeepSeek API: быстро, без инструментов.

Оба отдают ответ потоком: агент — NDJSON-событиями (``text`` — снимок шага,
``tool_call`` — вызов инструмента, ``final`` — итоговый текст), API — дельтами
SSE. Наружу оба показывают одно и то же: кусок текста через ``on_delta``.

Модель и усилие агента задаются на каждый запуск: у ``dsh headless`` нет флага
``--model``, поэтому :class:`AgentRunner` пишет временный patch-файл со строкой
``agent-default-model`` и передаёт его лаунчеру через ``--patch``.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

import aiohttp

#: Модели, между которыми переключают команды ``/flash`` и ``/pro``.
MODEL_FLASH = "deepseek-flash"
MODEL_PRO = "deepseek-v4-pro"
MODELS = (MODEL_FLASH, MODEL_PRO)

#: Значения ``reasoningEffort`` для команд ``/low``, ``/high``, ``/max``.
EFFORTS = ("low", "high", "max")

#: Права агента — те же пресеты, что в DSH: песочница и политика подтверждений.
#:
#: * ``read-only`` — читать можно, менять ничего нельзя;
#: * ``workspace-write`` — запись только в рабочую папку, спорное — по подтверждению;
#: * ``danger-full-access`` — вся машина без подтверждений (полный доступ).
PERMISSIONS = ("read-only", "workspace-write", "danger-full-access")

#: Права по умолчанию: полный доступ без подтверждений.
#:
#: У ``dsh headless`` нет интерактивного канала подтверждений, поэтому политика
#: ``ask`` там не спрашивает, а отказывает (fail closed). Полный доступ — режим,
#: в котором агент работает, а не молча упирается в отказ.
DEFAULT_PERMISSION = "danger-full-access"

#: Как называют права в командах и в жизни.
PERMISSION_ALIASES = {
    "full": "danger-full-access",
    "fullaccess": "danger-full-access",
    "full-access": "danger-full-access",
    "danger": "danger-full-access",
    "danger-full-access": "danger-full-access",
    "write": "workspace-write",
    "workspace": "workspace-write",
    "workspace-write": "workspace-write",
    "read": "read-only",
    "readonly": "read-only",
    "read-only": "read-only",
    "ro": "read-only",
}

#: Переменные окружения, которые нельзя наследовать: они описывают чужую сессию.
_DROP_ENV = (
    "DSH_SESSION_ID",
    "DSH_PROFILE",
    "DSH_PROFILE_DIR",
    "DSH_SHELL",
    "DSH_WEB_URL",
    # Права выставляет бот под каждый ход, а не внешняя среда запуска.
    "DSH_PERMISSION_MODE",
)


def normalize_permission(value: Optional[str]) -> Optional[str]:
    """Привести название прав к одному из :data:`PERMISSIONS`.

    :param value: как назвал пользователь: ``full``, ``workspace``, ``read-only``…
    :returns: каноническое имя или ``None``, если название неизвестно.
    """
    if not value:
        return None
    return PERMISSION_ALIASES.get(value.strip().lower().replace("_", "-"))


@dataclass
class TurnResult:
    """Результат одного хода."""

    text: str = ""
    session_id: Optional[str] = None
    usage: Optional[dict] = None
    error: Optional[str] = None
    aborted: bool = False


@dataclass
class AgentEvent:
    """Событие агента для интерфейса: текст шага или вызов инструмента."""

    kind: str
    text: str = ""
    label: str = ""


def resolve_dsh_bin() -> Optional[Path]:
    """Найти ``bin.js`` установленного dsh."""
    candidates = [
        os.environ.get("DSH_BIN_JS"),
        str(Path(os.environ.get("APPDATA", "")) / "npm" / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"),
        str(Path(os.environ.get("ProgramFiles", "")) / "nodejs" / "node_modules" / "@deepseek-ai" / "dsh" / "lib" / "bin.js"),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return Path(candidate)
    return None


def _tool_label(event: dict) -> str:
    """Подпись вызова инструмента: ``🔧 pwsh: Get-ChildItem …``."""
    tool = event.get("tool") or "tool"
    data = event.get("input") if isinstance(event.get("input"), dict) else {}
    for key in ("command", "pattern", "path", "file_path", "query", "prompt"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            short = " ".join(value.split())
            if len(short) > 70:
                short = short[:69] + "…"
            return f"🔧 {tool}: {short}"
    return f"🔧 {tool}"


class AgentRunner:
    """Запуск ``dsh headless --json`` с потоковым разбором событий."""

    def __init__(
        self,
        *,
        bin_js: Path,
        cwd: Path,
        dsh_home: Optional[Path] = None,
        profile: str = "headless",
        timeout: Optional[float] = None,
        idle_timeout: Optional[float] = None,
        patch_dir: Optional[Path] = None,
        permission: str = DEFAULT_PERMISSION,
        approval_url: Optional[str] = None,
        approval_token: Optional[str] = None,
    ) -> None:
        self.bin_js = bin_js
        self.cwd = cwd
        self.dsh_home = dsh_home
        self.profile = profile
        self.timeout = timeout
        self.idle_timeout = idle_timeout
        self.patch_dir = patch_dir or (Path(__file__).resolve().parent / ".runtime")
        self.permission = permission
        #: Локальный endpoint бота, куда плагин шлёт approval/request.
        self.approval_url = approval_url
        self.approval_token = approval_token

    def _env(self, permission: Optional[str] = None) -> dict[str, str]:
        """Окружение хода: своя сессия, свои права.

        ``DSH_PERMISSION_MODE`` читает ``dsh-sandbox-policy`` при сборке профиля:
        им задаётся и песочница, и политика подтверждений (полный доступ даёт
        ``never``). Флаг на каждый запуск — единственный способ переключить права
        у одноразового ``dsh headless``.
        """
        env = dict(os.environ)
        for name in _DROP_ENV:
            env.pop(name, None)
        if self.dsh_home is not None:
            env["DSH_HOME"] = str(self.dsh_home)
        env["DSH_PERMISSION_MODE"] = normalize_permission(permission) or self.permission
        return env

    def _patch_file(self, model: str, effort: Optional[str]) -> Path:
        """Записать patch-файл с выбранными моделью и усилием агента.

        Лаунчер применяет ``--patch`` после слоя профиля, поэтому строка
        ``agent-default-model`` перекрывает и профиль, и его умолчания. Файлы
        кешируются по паре «модель-усилие»: один и тот же набор может
        использовать несколько чатов одновременно.
        """
        if model not in MODELS:
            raise ValueError(f"неизвестная модель: {model}")
        if effort is not None and effort not in EFFORTS:
            raise ValueError(f"неизвестное усилие: {effort}")

        key = re.sub(r"[^a-z0-9._-]+", "-", f"{model}-{effort or 'default'}".lower())
        path = self.patch_dir / f"agent-{key}.yml"
        lines = [
            "# Создано telegram-bot: модель и усилие для этого запуска.",
            "# Можно удалить — бот перезапишет файл при следующем ходе.",
            "- id: agent-default-model",
            "  name: '@deepseek-ai/dsh-agent-default-model'",
            "  config:",
            "    provider: deepseek-official",
            f"    model: {model}",
        ]
        if effort is not None:
            lines.append(f"    reasoningEffort: {effort}")
        if self.approval_url:
            bridge = Path(__file__).resolve().parent / "approval_bridge.mjs"
            lines.extend(
                [
                    "- insert:",
                    "    - id: telegram-approval-bridge",
                    f"      name: '{bridge.as_uri()}'",
                    "      config:",
                    f"        url: '{self.approval_url}'",
                    f"        token: '{self.approval_token or ''}'",
                ]
            )
        content = "\n".join(lines) + "\n"

        try:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                path.parent.mkdir(parents=True, exist_ok=True)
                temporary = path.with_suffix(".tmp")
                temporary.write_text(content, encoding="utf-8")
                temporary.replace(path)
        except OSError as error:
            raise RuntimeError(f"не записал патч модели {path}: {error}") from error
        return path

    async def run(
        self,
        prompt: str,
        *,
        session_id: Optional[str] = None,
        on_event: Optional[Callable[[AgentEvent], None]] = None,
        model: Optional[str] = None,
        effort: Optional[str] = None,
        permission: Optional[str] = None,
    ) -> TurnResult:
        """Выполнить один ход агента на выбранных модели, усилии и правах."""
        args = ["node", str(self.bin_js), self.profile]
        if model is not None:
            # --patch — флаг лаунчера, он должен идти до аргументов приложения
            # (--json, --session-id), иначе те уйдут внутрь профиля.
            args.extend(["--patch", str(self._patch_file(model, effort))])
        args.append("--json")
        if session_id:
            args.extend(["--session-id", session_id])
        args.append("-")

        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                cwd=str(self.cwd),
                env=self._env(permission),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                creationflags=0x08000000 if os.name == "nt" else 0,  # CREATE_NO_WINDOW
            )
        except OSError as error:
            return TurnResult(error=f"не запустился dsh: {error}")

        assert process.stdin and process.stdout and process.stderr
        process.stdin.write(prompt.encode("utf-8"))
        await process.stdin.drain()
        process.stdin.close()

        text = ""
        final_text: Optional[str] = None
        found_session: Optional[str] = None
        usage: Optional[dict] = None
        stderr_tail = ""

        async def read_stderr() -> None:
            nonlocal stderr_tail
            assert process.stderr
            while True:
                chunk = await process.stderr.read(4096)
                if not chunk:
                    return
                stderr_tail = (stderr_tail + chunk.decode("utf-8", "replace"))[-4000:]

        stderr_task = asyncio.create_task(read_stderr())

        # 0/None — без лимита: длинный ход DeepSeek не обрываем.
        timeout_value = self.timeout if self.timeout and self.timeout > 0 else None
        idle_value = self.idle_timeout if self.idle_timeout and self.idle_timeout > 0 else None
        guard = asyncio.timeout(timeout_value) if timeout_value is not None else contextlib.nullcontext()
        try:
            async with guard:
                while True:
                    try:
                        raw = await asyncio.wait_for(process.stdout.readline(), idle_value)
                    except asyncio.TimeoutError:
                        # Сработает только если idle-лимит задан в конфиге.
                        # По умолчанию его нет: ждём ответ сколько нужно.
                        process.kill()
                        await process.wait()
                        return TurnResult(
                            text=text,
                            session_id=found_session,
                            error=f"агент молчал {idle_value:.0f} с — процесс остановлен, чат свободен",
                        )
                    if not raw:
                        break
                    line = raw.decode("utf-8", "replace").strip()
                    if not line:
                        continue
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    kind = event.get("type")
                    if kind == "session" and event.get("sessionId"):
                        found_session = event["sessionId"]
                    elif kind == "text" and isinstance(event.get("text"), str):
                        if event["text"]:
                            # «text» — снимок шага, а не дельта.
                            text = event["text"]
                            if on_event:
                                on_event(AgentEvent(kind="text", text=text))
                    elif kind == "final" and isinstance(event.get("text"), str):
                        final_text = event["text"]
                    elif kind == "tool_call":
                        if on_event:
                            on_event(AgentEvent(kind="tool", label=_tool_label(event)))
                    elif kind == "status" and isinstance(event.get("usage"), dict):
                        usage = event["usage"]
                code = await process.wait()
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()
            return TurnResult(text=text, session_id=found_session, error=f"агент не уложился в {timeout_value:.0f} с")
        except asyncio.CancelledError:
            process.kill()
            await process.wait()
            raise
        finally:
            stderr_task.cancel()

        result_text = (final_text if final_text is not None else text).strip()
        if code != 0 and not result_text:
            tail = " | ".join(stderr_tail.strip().splitlines()[-3:])
            return TurnResult(text=text, session_id=found_session, error=f"агент вышел с кодом {code}: {tail}")
        return TurnResult(text=result_text, session_id=found_session, usage=usage)


def _effort_rejected(body: str) -> bool:
    """Похоже ли тело ошибки на «неизвестный reasoning_effort»."""
    lowered = body.lower()
    return any(word in lowered for word in ("reasoning", "effort", "unknown", "unrecognized", "unexpected"))


async def run_chat(
    *,
    session: aiohttp.ClientSession,
    api_key: str,
    model: str,
    messages: list[dict[str, str]],
    max_tokens: int,
    on_delta: Optional[Callable[[str], None]] = None,
    reasoning_effort: Optional[str] = None,
) -> TurnResult:
    """Прямой запрос к DeepSeek API с потоковой отдачей.

    ``reasoning_effort`` уходит в запрос как есть. Если API его не знает
    (400/422 с упоминанием effort/reasoning), запрос повторяется один раз без
    этого поля — режим ``/fast`` не ломается на модели без ручки усилия.
    """
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "max_tokens": max_tokens,
    }
    if reasoning_effort is not None:
        payload["reasoning_effort"] = reasoning_effort
    headers = {"authorization": f"Bearer {api_key}", "content-type": "application/json"}

    text = ""
    usage: Optional[dict] = None
    attempt = 0
    while True:
        try:
            async with session.post(
                "https://api.deepseek.com/chat/completions",
                json=payload,
                headers=headers,
                timeout=aiohttp.ClientTimeout(total=300, sock_read=180),
            ) as response:
                if response.status != 200:
                    body = await response.text()
                    if (
                        attempt == 0
                        and "reasoning_effort" in payload
                        and response.status in (400, 422)
                        and _effort_rejected(body)
                    ):
                        # Модель/шлюз не принимает усилие — повторяем без него.
                        payload.pop("reasoning_effort", None)
                        attempt = 1
                        continue
                    return TurnResult(error=f"DeepSeek API {response.status}: {body[:300]}")

                buffer = ""
                async for raw in response.content:
                    # События SSE разделены пустой строкой. Приходить они могут как с
                    # \n, так и с \r\n — нормализуем, иначе разделитель не находится
                    # и поток разбирается в пустоту.
                    buffer += raw.decode("utf-8", "replace").replace("\r\n", "\n")
                    while "\n\n" in buffer:
                        block, buffer = buffer.split("\n\n", 1)
                        for line in block.splitlines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                continue
                            try:
                                event = json.loads(data)
                            except json.JSONDecodeError:
                                continue
                            choices = event.get("choices") or []
                            if choices:
                                delta = (choices[0].get("delta") or {}).get("content")
                                if delta:
                                    text += delta
                                    if on_delta:
                                        on_delta(delta)
                            if event.get("usage"):
                                usage = event["usage"]
                return TurnResult(text=text.strip(), usage=usage)
        except asyncio.CancelledError:
            raise
        except (aiohttp.ClientError, asyncio.TimeoutError) as error:
            return TurnResult(text=text, error=f"сеть до api.deepseek.com: {error}")
