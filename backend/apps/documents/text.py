"""Разбор структуры документа ProseMirror.

Документ хранится деревом узлов, а не строкой HTML. Здесь — операции, которые
нужны серверу: обычный текст для поиска и оглавление для навигации.
"""
from typing import Any

# Узлы, после которых текст продолжается с новой строки: иначе заголовок
# склеится со следующим абзацем и поиск найдёт несуществующую фразу.
BLOCK_NODES = {
    "paragraph", "heading", "listItem", "blockquote", "codeBlock",
    "tableRow", "tableCell", "tableHeader", "taskItem",
}

MAX_TEXT_LENGTH = 1_000_000


def extract_plain_text(content: Any, limit: int = MAX_TEXT_LENGTH) -> str:
    """Собирает читаемый текст из дерева узлов."""
    parts: list[str] = []
    _walk_text(content, parts, limit)
    text = "".join(parts)
    return text[:limit].strip()


def _walk_text(node: Any, parts: list[str], limit: int) -> None:
    if not isinstance(node, dict):
        return
    if sum(len(part) for part in parts) >= limit:
        return

    node_type = node.get("type")

    if node_type == "text":
        parts.append(node.get("text", ""))
        return

    # Смарт-чипы и упоминания несут подпись в атрибутах, а не в тексте.
    if node_type in {"mention", "smartChip", "dateChip"}:
        label = (node.get("attrs") or {}).get("label", "")
        if label:
            parts.append(str(label))
        return

    for child in node.get("content") or []:
        _walk_text(child, parts, limit)

    if node_type in BLOCK_NODES:
        parts.append("\n")


def extract_headings(content: Any) -> list[dict]:
    """Оглавление: уровень, текст и якорь каждого заголовка."""
    headings: list[dict] = []
    _walk_headings(content, headings)
    return headings


def _walk_headings(node: Any, headings: list[dict]) -> None:
    if not isinstance(node, dict):
        return

    if node.get("type") == "heading":
        attrs = node.get("attrs") or {}
        text_parts: list[str] = []
        _walk_text(node, text_parts, MAX_TEXT_LENGTH)
        text = "".join(text_parts).strip()
        if text:
            headings.append({
                "level": attrs.get("level", 1),
                "text": text,
                # Якорь задаётся редактором при вводе заголовка; без него
                # ссылка на раздел ломалась бы при изменении текста.
                "anchor": attrs.get("id") or "",
            })

    for child in node.get("content") or []:
        _walk_headings(child, headings)


def count_stats(content: Any) -> dict:
    """Слова, знаки и абзацы — показываются в меню «Инструменты»."""
    text = extract_plain_text(content)
    words = [word for word in text.split() if word]
    return {
        "characters": len(text),
        "characters_no_spaces": len(text.replace(" ", "").replace("\n", "")),
        "words": len(words),
        "paragraphs": len([line for line in text.split("\n") if line.strip()]),
    }
