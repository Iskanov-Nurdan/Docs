"""Преобразование книги в файлы.

Документ — листы с ячейками. Здесь он превращается в CSV, Excel, HTML
и PDF. Разметка ProseMirror отсюда убрана вместе с текстовым редактором.
"""
import html
import logging
import re
from io import BytesIO

logger = logging.getLogger(__name__)

# Символы, с которых Excel и прочие таблицы начинают читать ячейку как формулу.
_FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")


def _defuse(value: str) -> str:
    """Обезвреживает значение, которое получатель прочитал бы как формулу.

    Два повода. Первый: в `display` шаблонных таблиц лежит сама формула
    («=СУММ(I2:I4)»), имена функций у нас русские, и открывший выгрузку видел
    «#ИМЯ?» вместо суммы. Второй: ячейка вида `=cmd|'/c calc'!A0`, набранная
    одним редактором, выполнялась бы у того, кто откроет файл.

    Апостроф впереди — то, чем таблицы помечают «это текст»; при открытии он
    не показывается.
    """
    if value.startswith(_FORMULA_STARTS):
        return "'" + value
    return value


def html_to_pdf(html_source: str) -> bytes:
    """PDF из HTML. Разметка и разбивка на страницы задаются стилями печати."""
    from weasyprint import HTML

    buffer = BytesIO()
    HTML(string=html_source).write_pdf(buffer)
    return buffer.getvalue()


# ------------------------------- Таблицы -------------------------------
#
# Книга хранится разреженно: в content лежат только заполненные ячейки
# ("A1", "C7"), а не прямоугольник целиком. Для выгрузки её приходится
# разворачивать в строки — по крайней заполненной ячейке.


# Границы листа — те же, что и в редакторе (frontend/src/spreadsheet/formula.ts).
# Без них одна ячейка с адресом «A100000000» разворачивалась в сетку на
# сто миллионов строк: выгрузка съедала всю память и убивала рабочий процесс,
# а задача при этом дважды повторялась.
MAX_ROWS = 5000
MAX_COLS = 100

# Ещё один потолок, поверх размеров: разреженная книга может быть узкой и
# очень длинной, и произведение важнее каждой из сторон по отдельности.
MAX_CELLS = MAX_ROWS * MAX_COLS

_ADDRESS = re.compile(r"^\$?([A-Za-z]{1,4})\$?([0-9]{1,7})$")


def _column_index(letters: str) -> int:
    """A -> 0, B -> 1, Z -> 25, AA -> 26."""
    index = 0
    for char in letters:
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index - 1


def parse_address(address: str) -> tuple[int, int] | None:
    """Разбирает адрес ячейки. None — адрес битый или за пределами листа.

    Разбор строгий. Прежний собирал буквы и цифры по всей строке, поэтому
    «A1B2» превращалось в AB12 — ячейка уезжала не туда, куда указывала, —
    а «A0» давало строку -1 и молча пропадало из выгрузки.
    """
    match = _ADDRESS.match(address.strip())
    if not match:
        return None

    row = int(match.group(2)) - 1
    column = _column_index(match.group(1).upper())
    if row < 0 or row >= MAX_ROWS:
        return None
    if column < 0 or column >= MAX_COLS:
        return None
    return row, column


def sheet_to_rows(content: dict, sheet_index: int = 0) -> list[list[str]]:
    """Лист книги — прямоугольником строк.

    В файл уходит показанное значение (`display`), а не формула: получатель
    открывает выгрузку, чтобы увидеть числа, а не способ их получения.
    """
    sheets = content.get("sheets") or []
    if sheet_index >= len(sheets):
        return []

    sheet = sheets[sheet_index]
    cells = sheet.get("cells") if isinstance(sheet, dict) else None
    # Содержимое приходит из базы и могло быть записано когда угодно: если
    # ячейки не словарь, выгрузка должна выйти пустой, а не упасть с 500.
    if not isinstance(cells, dict):
        return []

    parsed: dict[tuple[int, int], str] = {}

    for address, cell in cells.items():
        position = parse_address(str(address))
        if position is None:
            continue
        if isinstance(cell, dict):
            value = cell.get("display")
            if value in (None, ""):
                value = cell.get("value")
        else:
            value = cell
        if value in (None, ""):
            continue
        parsed[position] = str(value)

    if not parsed:
        return []

    height = max(row for row, _ in parsed) + 1
    width = max(column for _, column in parsed) + 1

    if height * width > MAX_CELLS:
        logger.warning(
            "Лист %s разворачивается в %s ячеек — выгрузка обрезана до %s",
            sheet_index, height * width, MAX_CELLS,
        )
        height = min(height, MAX_ROWS)
        width = min(width, MAX_COLS)

    return [
        [parsed.get((row, column), "") for column in range(width)]
        for row in range(height)
    ]


def sheet_to_csv(content: dict) -> str:
    """CSV с разделителем «;»: Excel в русской локали ждёт именно его."""
    import csv
    from io import StringIO

    buffer = StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerows([_defuse(cell) for cell in row] for row in sheet_to_rows(content))
    return buffer.getvalue()


def sheet_to_text(content: dict) -> str:
    """Табуляция между колонками — так значения переносятся в другие таблицы."""
    return "\n".join("\t".join(row) for row in sheet_to_rows(content))


def sheet_to_html(content: dict, *, title: str = "") -> str:
    rows = sheet_to_rows(content)
    body = "\n".join(
        "<tr>" + "".join(f"<td>{html.escape(cell)}</td>" for cell in row) + "</tr>"
        for row in rows
    )
    return (
        '<!doctype html>\n<html lang="ru"><head><meta charset="utf-8">'
        f"<title>{html.escape(title)}</title>"
        "<style>body{font-family:Arial,sans-serif;padding:24px}"
        "table{border-collapse:collapse}"
        "td{border:1px solid #d1e0f0;padding:4px 8px;font-size:11pt}</style>"
        f"</head><body><h1>{html.escape(title)}</h1><table>{body}</table></body></html>"
    )


# Предел формата OOXML, а не наш: шире Word таблицу не открывает.
_DOCX_MAX_COLS = 63


def sheet_to_docx(content: dict, *, title: str = "") -> bytes:
    from docx import Document as DocxDocument

    rows = sheet_to_rows(content)
    document = DocxDocument()
    if title:
        document.add_heading(title, level=1)

    if rows:
        # Word держит в таблице не больше 63 колонок: более широкий документ
        # получается, но не открывается. Лишнее отрезаем и говорим об этом.
        width = min(max(len(row) for row in rows), _DOCX_MAX_COLS)
        if any(len(row) > _DOCX_MAX_COLS for row in rows):
            logger.warning("Таблица шире %s колонок — в DOCX уходит только начало",
                           _DOCX_MAX_COLS)

        table = document.add_table(rows=0, cols=width)
        table.style = "Table Grid"
        for row in rows:
            cells = table.add_row().cells
            for index, value in enumerate(row[:width]):
                cells[index].text = value

    buffer = BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def sheet_to_xlsx(content: dict, *, title: str = "") -> bytes:
    """Книга Excel.

    В ячейки уходят значения, а не формулы: имена функций у нас русские
    (СУММ, ЕСЛИ), и Excel их не понял бы — открывший файл увидел бы ошибку
    вместо числа. Числа при этом остаются числами, чтобы в Excel работали
    сортировка и собственные формулы поверх выгрузки.
    """
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font
    from openpyxl.utils import get_column_letter

    rows = sheet_to_rows(content)

    workbook = Workbook()
    sheet = workbook.active
    # Имя листа Excel ограничивает и запрещает часть символов.
    sheet.title = "".join(ch for ch in (title or "Лист1") if ch not in "[]:*?/\\")[:31] or "Лист1"

    for row_index, row in enumerate(rows, start=1):
        for column_index, value in enumerate(row, start=1):
            cell = sheet.cell(row=row_index, column=column_index)
            number = _as_number(value)
            if number is None:
                cell.value = value
                # openpyxl решает «формула это или текст» по ведущему «=».
                # Без явного типа выгрузка таблицы из шаблона открывалась
                # с «#ИМЯ?» в каждой колонке с итогом.
                if value:
                    cell.data_type = "s"
            else:
                cell.value = number
                cell.alignment = Alignment(horizontal="right")

    # Первая строка почти всегда шапка: выделяем её и закрепляем при прокрутке.
    if rows:
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        sheet.freeze_panes = "A2"

        widths: dict[int, int] = {}
        for row in rows:
            for column_index, value in enumerate(row, start=1):
                widths[column_index] = max(widths.get(column_index, 8), min(len(value) + 2, 60))
        for column_index, width in widths.items():
            sheet.column_dimensions[get_column_letter(column_index)].width = width

    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


# Знаки валют, которые дописывает формат ячейки. В Excel им не место:
# число со знаком внутри становится текстом, и ни сортировка, ни СУММ по
# колонке уже не работают — а выгрузку берут как раз чтобы считать.
_CURRENCY_MARKS = ("₽", "¥", "$", "€", "₸", "⃀", "сом", "com")


# Что именно считается числом. Правила те же, что в редакторе (parseLiteral):
# пробел разделяет разряды только группами по три, ведущий ноль оставляет
# текст текстом. Без этого «+996 700 123 456» уезжало в файл как 996700123456,
# «007» превращалось в 7, а номер счёта из девятнадцати цифр терял разряды.
_NUMBER = re.compile(
    r"^-?(?:[0-9]{1,3}(?:[  ][0-9]{3})+|[0-9]+)(?:[.,][0-9]+)?$"
)

# Больше пятнадцати значащих цифр float не держит: такие строки — это номера,
# а не количества, и округлять их нельзя.
_MAX_DIGITS = 15


def _as_number(value: str) -> float | int | None:
    """Строка «1 234,56» и «1 234,56 сом» — это число. Пустая строка и текст — нет."""
    text = (value or "").strip()
    lowered = text.lower()
    for mark in _CURRENCY_MARKS:
        if lowered.endswith(mark):
            text = text[: len(text) - len(mark)].strip()
            break

    if not text or not _NUMBER.match(text):
        return None

    # «007» и «0123» — номер накладной, а не число: ведущий ноль не переживёт.
    if re.match(r"^-?0[0-9]", text):
        return None

    digits = "".join(ch for ch in text if ch.isdigit()).lstrip("0")
    if len(digits) > _MAX_DIGITS:
        return None

    normalized = text.replace(" ", "").replace(" ", "").replace(",", ".")
    try:
        number = float(normalized)
    except ValueError:
        return None

    # inf и nan openpyxl записывает пустым значением: ячейка исчезала молча.
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return int(number) if number.is_integer() else number
