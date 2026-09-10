"""Преобразование документа между внутренним форматом и файлами.

Внутренний формат — дерево узлов ProseMirror. Здесь оно превращается в HTML
(из него получаются PDF и печать), в DOCX и обратно.
"""
import html
import logging
from io import BytesIO
from typing import Any

logger = logging.getLogger(__name__)

# Как размечать узлы в HTML: тег и нужен ли перевод строки после.
BLOCK_TAGS = {
    "paragraph": "p",
    "blockquote": "blockquote",
    "codeBlock": "pre",
    "bulletList": "ul",
    "orderedList": "ol",
    "listItem": "li",
    "taskList": "ul",
    "table": "table",
    "tableRow": "tr",
    "tableCell": "td",
    "tableHeader": "th",
}

MARK_TAGS = {
    "bold": "strong",
    "italic": "em",
    "underline": "u",
    "strike": "s",
    "code": "code",
    "superscript": "sup",
    "subscript": "sub",
}


def document_to_html(content: dict, *, title: str = "") -> str:
    """Собирает самостоятельную HTML-страницу — её можно опубликовать как есть."""
    body = _node_to_html(content)
    safe_title = html.escape(title or "Документ")
    return (
        "<!doctype html>\n"
        f'<html lang="ru"><head><meta charset="utf-8">'
        f"<title>{safe_title}</title>"
        "<style>body{font-family:Georgia,serif;max-width:820px;margin:40px auto;"
        "line-height:1.6;padding:0 20px}table{border-collapse:collapse;width:100%}"
        "td,th{border:1px solid #ccc;padding:6px 10px}img{max-width:100%}</style>"
        f"</head><body>{body}</body></html>"
    )


def _node_to_html(node: Any) -> str:
    if not isinstance(node, dict):
        return ""

    node_type = node.get("type")

    if node_type == "text":
        text = html.escape(node.get("text", ""))
        # Метки оборачиваются в обратном порядке: ссылка снаружи начертания.
        for mark in reversed(node.get("marks") or []):
            mark_type = mark.get("type")
            if mark_type == "link":
                href = html.escape((mark.get("attrs") or {}).get("href", ""), quote=True)
                text = f'<a href="{href}" rel="noopener noreferrer">{text}</a>'
            elif mark_type in MARK_TAGS:
                tag = MARK_TAGS[mark_type]
                text = f"<{tag}>{text}</{tag}>"
        return text

    if node_type == "image":
        attrs = node.get("attrs") or {}
        src = html.escape(attrs.get("src", ""), quote=True)
        alt = html.escape(attrs.get("alt", ""), quote=True)
        return f'<img src="{src}" alt="{alt}">'

    if node_type == "hardBreak":
        return "<br>"

    if node_type == "horizontalRule":
        return "<hr>"

    children = "".join(_node_to_html(child) for child in node.get("content") or [])

    if node_type == "heading":
        level = min(max(int((node.get("attrs") or {}).get("level", 1)), 1), 6)
        anchor = (node.get("attrs") or {}).get("id")
        # Якорь нужен оглавлению и ссылкам на раздел.
        anchor_attr = f' id="{html.escape(str(anchor), quote=True)}"' if anchor else ""
        return f"<h{level}{anchor_attr}>{children}</h{level}>"

    if node_type == "taskItem":
        checked = (node.get("attrs") or {}).get("checked")
        box = "☑" if checked else "☐"
        return f"<li>{box} {children}</li>"

    if node_type in BLOCK_TAGS:
        tag = BLOCK_TAGS[node_type]
        return f"<{tag}>{children}</{tag}>"

    return children


def document_to_text(content: dict) -> str:
    from apps.documents.text import extract_plain_text

    return extract_plain_text(content)


def html_to_pdf(html_source: str) -> bytes:
    """PDF из HTML. Разметка и разбивка на страницы задаются стилями печати."""
    from weasyprint import HTML

    buffer = BytesIO()
    HTML(string=html_source).write_pdf(buffer)
    return buffer.getvalue()


def document_to_docx(content: dict, *, title: str = "") -> bytes:
    """DOCX из дерева узлов: заголовки, абзацы, списки и таблицы."""
    from docx import Document as DocxDocument

    document = DocxDocument()
    if title:
        document.core_properties.title = title

    for node in content.get("content") or []:
        _docx_node(document, node)

    buffer = BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def _docx_node(document, node: dict) -> None:
    node_type = node.get("type")

    if node_type == "heading":
        level = min(max(int((node.get("attrs") or {}).get("level", 1)), 1), 6)
        document.add_heading(_node_text(node), level=level)
    elif node_type == "paragraph":
        text = _node_text(node)
        if text:
            document.add_paragraph(text)
    elif node_type in {"bulletList", "taskList"}:
        for item in node.get("content") or []:
            document.add_paragraph(_node_text(item), style="List Bullet")
    elif node_type == "orderedList":
        for item in node.get("content") or []:
            document.add_paragraph(_node_text(item), style="List Number")
    elif node_type == "blockquote":
        document.add_paragraph(_node_text(node), style="Intense Quote")
    elif node_type == "table":
        _docx_table(document, node)
    else:
        text = _node_text(node)
        if text:
            document.add_paragraph(text)


def _docx_table(document, node: dict) -> None:
    rows = node.get("content") or []
    if not rows:
        return
    columns = max(len(row.get("content") or []) for row in rows)
    table = document.add_table(rows=0, cols=columns)
    table.style = "Table Grid"

    for row in rows:
        cells = table.add_row().cells
        for index, cell in enumerate(row.get("content") or []):
            if index < columns:
                cells[index].text = _node_text(cell)


def _node_text(node: Any) -> str:
    from apps.documents.text import extract_plain_text

    return extract_plain_text(node).replace("\n", " ").strip()


def docx_to_document(file_obj) -> dict:
    """Разбор DOCX во внутренний формат: заголовки, абзацы, списки, таблицы."""
    from docx import Document as DocxDocument

    source = DocxDocument(file_obj)
    content: list[dict] = []

    for paragraph in source.paragraphs:
        text = paragraph.text.strip()
        if not text:
            continue

        style = (paragraph.style.name or "").lower()
        if style.startswith("heading"):
            try:
                level = int(style.split()[-1])
            except (ValueError, IndexError):
                level = 1
            content.append({
                "type": "heading",
                "attrs": {"level": min(max(level, 1), 6)},
                "content": [{"type": "text", "text": text}],
            })
        elif "list bullet" in style:
            content.append(_list_item("bulletList", text))
        elif "list number" in style:
            content.append(_list_item("orderedList", text))
        else:
            content.append({"type": "paragraph", "content": [{"type": "text", "text": text}]})

    for table in source.tables:
        content.append(_table_node(table))

    if not content:
        content = [{"type": "paragraph"}]
    return {"type": "doc", "content": content}


def _list_item(list_type: str, text: str) -> dict:
    return {
        "type": list_type,
        "content": [{
            "type": "listItem",
            "content": [{"type": "paragraph", "content": [{"type": "text", "text": text}]}],
        }],
    }


def _table_node(table) -> dict:
    rows = []
    for row in table.rows:
        cells = [
            {
                "type": "tableCell",
                "content": [{
                    "type": "paragraph",
                    "content": ([{"type": "text", "text": cell.text}] if cell.text else []),
                }],
            }
            for cell in row.cells
        ]
        rows.append({"type": "tableRow", "content": cells})
    return {"type": "table", "content": rows}


def text_to_document(text: str) -> dict:
    """Простой текст: каждая непустая строка — абзац."""
    paragraphs = [
        {"type": "paragraph", "content": [{"type": "text", "text": line}]}
        for line in text.splitlines()
        if line.strip()
    ]
    return {"type": "doc", "content": paragraphs or [{"type": "paragraph"}]}
