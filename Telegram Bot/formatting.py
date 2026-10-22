"""formatting.py — обычный Markdown модели → Telegram MarkdownV2.

Модель отвечает обычным Markdown (``**жирный**``, ``# заголовок``, списки,
```` ```код``` ````, ссылки), а Telegram в режиме MarkdownV2 требует
экранировать почти всю пунктуацию: ``_ * [ ] ( ) ~ ` > # + - = | { } . !``.
Если отдать моделиный текст как есть, Telegram отвечает
``can't parse entities``, и сообщение либо падает, либо уходит простым текстом —
именно это выглядит как «парсинг не применился».

Модуль преобразует разметку: сначала вырезает конструкции, которые сами
являются разметкой (код, ссылки, жирный, курсив, зачёркивание), экранирует всё
остальное и только потом собирает строку V2. Вложенность поддерживается
рекурсией: ``**текст с `кодом`**`` разбирается целиком.
"""

from __future__ import annotations

import re

#: Символы, которые в MarkdownV2 обязаны быть экранированы.
_SPECIAL = re.compile(r"([_*\[\]()~`>#+\-=|{}.!\\])")

#: Одна конструкция разметки. Порядок альтернатив важен: код и ссылки
#: вырезаются раньше жирного, иначе звёздочки внутри URL ломали бы разбор.
#: ``**`` проверяется раньше ``*``, иначе жирный читался бы как курсив.
_INLINE = re.compile(
    r"`(?P<code>[^`\n]+)`"
    r"|\[(?P<ltext>[^\]\n]+)\]\((?P<url>https?://[^\s)]+)\)"
    r"|\*\*(?P<bold>.+?)\*\*"
    r"|__(?P<bold2>.+?)__"
    r"|~~(?P<strike>.+?)~~"
    r"|\*(?P<ital>[^*\n]+)\*"
    r"|(?<![\w])_(?P<ital2>[^_\n]+)_(?![\w])"
)

#: Блок кода вместе с необязательным языком после открывающих кавычек.
_FENCE = re.compile(r"```[ \t]*([A-Za-z0-9_+.\-]*)\r?\n?(.*?)```", re.DOTALL)

#: Заголовок Markdown в начале строки.
_HEADING = re.compile(r"^[ \t]{0,3}(#{1,6})[ \t]+(.*)$")

#: Пункт маркированного списка.
_BULLET = re.compile(r"^([ \t]*)[-*+][ \t]+(.*)$")

#: Пункт нумерованного списка.
_NUMBERED = re.compile(r"^([ \t]*)\d+\.[ \t]+(.*)$")

#: Цитата.
_QUOTE = re.compile(r"^[ \t]{0,3}>[ \t]?(.*)$")


def escape(text: str) -> str:
    """Экранировать все служебные символы MarkdownV2."""
    return _SPECIAL.sub(r"\\\1", text)


def _escape_code(text: str) -> str:
    """Внутри кода и предформата экранируются только ``\\`` и обратная кавычка."""
    return text.replace("\\", "\\\\").replace("`", "\\`")


#: Публичное имя: бот строит блоки кода сам (карточка операций агента).
escape_code = _escape_code


def _inline(text: str) -> str:
    """Разобрать одну строку без блоков кода и вернуть готовый MarkdownV2."""
    if not text:
        return ""
    out: list[str] = []
    position = 0
    for match in _INLINE.finditer(text):
        out.append(escape(text[position:match.start()]))
        position = match.end()
        if match.group("code") is not None:
            out.append("`" + _escape_code(match.group("code")) + "`")
        elif match.group("ltext") is not None:
            label = _inline(match.group("ltext"))
            url = match.group("url").replace("\\", "\\\\").replace(")", "\\)")
            out.append(f"[{label}]({url})")
        elif match.group("bold") is not None:
            out.append("*" + _inline(match.group("bold")) + "*")
        elif match.group("bold2") is not None:
            out.append("*" + _inline(match.group("bold2")) + "*")
        elif match.group("strike") is not None:
            out.append("~" + _inline(match.group("strike")) + "~")
        elif match.group("ital") is not None:
            out.append("_" + _inline(match.group("ital")) + "_")
        else:
            out.append("_" + _inline(match.group("ital2")) + "_")
    out.append(escape(text[position:]))
    return "".join(out)


def _text_block(text: str) -> str:
    """Разобрать кусок обычного текста построчно."""
    lines = []
    for line in text.split("\n"):
        heading = _HEADING.match(line)
        if heading is not None:
            title = _inline(heading.group(2).strip())
            lines.append(f"*{title}*" if title else "")
            continue
        quote = _QUOTE.match(line)
        if quote is not None:
            lines.append("▎ " + _inline(quote.group(1)))
            continue
        bullet = _BULLET.match(line)
        if bullet is not None:
            lines.append(bullet.group(1) + "• " + _inline(bullet.group(2)))
            continue
        numbered = _NUMBERED.match(line)
        if numbered is not None:
            lines.append(numbered.group(1) + _inline(line.lstrip()))
            continue
        lines.append(_inline(line))
    return "\n".join(lines)


def md_to_v2(markdown: str) -> str:
    """Преобразовать обычный Markdown в MarkdownV2."""
    if not markdown:
        return ""
    out: list[str] = []
    position = 0
    for match in _FENCE.finditer(markdown):
        out.append(_text_block(markdown[position:match.start()]))
        code = match.group(2).rstrip("\n")
        out.append("```" + _escape_code(code) + "```")
        position = match.end()
    out.append(_text_block(markdown[position:]))
    return "".join(out)


def split_for_telegram(markdown: str, limit: int = 3200) -> list[str]:
    """Разрезать исходный Markdown на части, каждая из которых влезет в сообщение.

    Режем именно исходник, а не готовый V2: экранирование добавляет символы, и
    граница, посчитанная по готовой строке, разорвала бы сущность пополам.
    """
    if len(markdown) <= limit:
        return [markdown]
    chunks: list[str] = []
    rest = markdown
    while len(rest) > limit:
        cut = rest.rfind("\n", 0, limit)
        if cut < limit // 3:
            cut = limit
        chunks.append(rest[:cut])
        rest = rest[cut:].lstrip("\n")
    if rest.strip():
        chunks.append(rest)
    return chunks


def prepare_chunks(markdown: str, limit: int = 3800) -> list[str]:
    """Нарезать ответ на готовые к отправке куски MarkdownV2."""
    prepared: list[str] = []
    for chunk in split_for_telegram(markdown):
        rendered = md_to_v2(chunk)
        if len(rendered) <= limit:
            prepared.append(rendered)
            continue
        # Готовый кусок всё равно длинный (много разметки) — режем по строкам.
        for piece in split_for_telegram(chunk, max(600, limit // 2)):
            prepared.append(md_to_v2(piece))
    return prepared
