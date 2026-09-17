"""Перенос таблицы из файла в книгу.

Обратная сторона converters.py: там книга превращается в файл, здесь файл —
в книгу. Поддерживаются .xlsx, .xlsm, .xls и .csv: именно их присылают, когда
таблицу вели в Excel и хотят продолжить здесь.

Формат определяется по содержимому, а не по расширению. «.xls» — это три
разных формата под одним именем: двоичная книга Excel 97–2003, XML-таблица
Excel 2003 и обычная HTML-страница с таблицей. Последние два так выгружают
учётные и отслеживающие системы, и Excel открывает их молча — человек уверен,
что у него настоящий Excel. Бывает и наоборот: «.xls» переименовали из .xlsx.

Формулы переносятся как есть. Редактор принимает английские имена наравне
с русскими (SUM, IF, COUNTIF — см. ALIASES в frontend/src/spreadsheet/
formula.ts), поэтому переводить их незачем. На месте функции, которой редактор
не знает, оказалось бы «#ИМЯ?» — вместо неё подставляется значение, посчитанное
Excel при сохранении. Если и значения нет (книгу ни разу не открывали в Excel),
переносится сама формула: «#ИМЯ?» можно исправить, пустую ячейку — нет.
"""
import csv
import io
import logging
import re
from datetime import date, datetime, time

logger = logging.getLogger(__name__)

# Пределы листа в редакторе (frontend/src/spreadsheet/formula.ts). Файл крупнее
# обрезается: строки за границей всё равно негде показать.
MAX_ROWS = 200000
MAX_COLS = 100

# Имена функций, которые понимает редактор, — русские и английские вместе.
# Список зеркалит FUNCTIONS, LAZY_FUNCTIONS и ALIASES из formula.ts. Если там
# появится новая функция, здесь её надо добавить: иначе формула с ней приедет
# числом, а не формулой. Потери данных это не даёт — значение сохранится.
SUPPORTED_FUNCTIONS = {
    # Русские
    "СУММ", "СРЗНАЧ", "МИН", "МАКС", "СЧЁТ", "СЧЕТ", "СЧЁТЗ", "СЧЕТЗ",
    "ПРОИЗВЕД", "МЕДИАНА", "ОКРУГЛ", "КОРЕНЬ", "СТЕПЕНЬ", "ОСТАТ",
    "ЕСЛИ", "ЕСЛИОШИБКА", "И", "ИЛИ", "НЕ", "СЦЕПИТЬ", "ДЛСТР",
    "ПРОПИСН", "СТРОЧН", "СЖПРОБЕЛЫ", "ЛЕВСИМВ", "ПРАВСИМВ", "ПСТР",
    "СЧЁТЕСЛИ", "СЧЕТЕСЛИ", "СУММЕСЛИ", "СЕГОДНЯ", "ТДАТА", "АБС",
    # Английские
    "SUM", "AVERAGE", "MIN", "MAX", "COUNT", "COUNTA", "PRODUCT", "MEDIAN",
    "ROUND", "SQRT", "POWER", "MOD", "IF", "IFERROR", "AND", "OR", "NOT",
    "CONCAT", "CONCATENATE", "LEN", "UPPER", "LOWER", "TRIM", "LEFT", "RIGHT",
    "MID", "COUNTIF", "SUMIF", "TODAY", "NOW", "ABS",
}

# Имя функции в формуле: буквы и цифры перед открывающей скобкой.
_CALL = re.compile(r"([A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё0-9_.]*)\s*\(")

_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


class ImportError_(Exception):
    """Файл не удалось разобрать. Текст уходит человеку как есть."""


def cell_ref(row: int, col: int) -> str:
    """Номера строки и столбца (с нуля) — в адрес вида «A1», «AB12»."""
    letters = ""
    index = col
    while True:
        letters = _LETTERS[index % 26] + letters
        index = index // 26 - 1
        if index < 0:
            break
    return f"{letters}{row + 1}"


def _formula_supported(formula: str) -> bool:
    """Все ли функции формулы известны редактору."""
    names = {match.group(1).upper() for match in _CALL.finditer(formula)}
    return names <= {name.upper() for name in SUPPORTED_FUNCTIONS}


def _as_text(value) -> str:
    """Значение ячейки Excel — в то, что хранит книга.

    Дата приводится к «11.09.2026», а время к «18:00»: редактор ждёт именно
    такую запись, и по ней же считается просрочка в колонке срока.
    """
    if value is None:
        return ""
    if isinstance(value, bool):
        return "ИСТИНА" if value else "ЛОЖЬ"
    if isinstance(value, datetime):
        # Полночь без даты Excel хранит как дату — показываем только время,
        # если в ячейке не было ничего, кроме него.
        if value.hour or value.minute:
            return value.strftime("%d.%m.%Y %H:%M")
        return value.strftime("%d.%m.%Y")
    if isinstance(value, date):
        return value.strftime("%d.%m.%Y")
    if isinstance(value, time):
        return value.strftime("%H:%M")
    if isinstance(value, float):
        # 128400.0 — это 128400. Лишний нуль после запятой в таблице мешает.
        if value.is_integer():
            return str(int(value))
        return repr(value)
    return str(value)


def xlsx_to_book(data: bytes) -> dict:
    """Книга Excel — в нашу книгу. Переносятся все листы."""
    from openpyxl import load_workbook
    from openpyxl.utils.exceptions import InvalidFileException

    try:
        # Два прохода: в первом лежат формулы, во втором — то, что Excel
        # посчитал при сохранении. Второй нужен там, где формулу перенести
        # нельзя, и как запасной вариант для файла без формул вовсе.
        formulas = load_workbook(io.BytesIO(data), data_only=False, read_only=True)
        values = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    except InvalidFileException as error:
        raise ImportError_("Это не книга Excel. Подойдёт .xlsx, .xlsm или .csv.") from error
    except Exception as error:  # noqa: BLE001 — библиотека кидает что угодно
        logger.warning("Не удалось разобрать книгу Excel: %s", error)
        raise ImportError_("Файл повреждён или защищён паролем.") from error

    sheets = []
    try:
        for index, name in enumerate(formulas.sheetnames):
            formula_sheet = formulas[name]
            value_sheet = values[name]
            cells = _read_sheet(formula_sheet, value_sheet)
            sheets.append({"id": f"s{index + 1}", "name": name[:50] or f"Лист{index + 1}",
                           "cells": cells})
    finally:
        formulas.close()
        values.close()

    if not sheets:
        raise ImportError_("В книге нет ни одного листа.")
    return {"kind": "sheet", "sheets": sheets}


def _read_sheet(formula_sheet, value_sheet) -> dict:
    """Ячейки одного листа. Пустые не хранятся: книга разрежена."""
    cells: dict[str, dict] = {}

    # zip по строкам обоих проходов: у read_only-листа нет доступа по адресу,
    # строки отдаются потоком и только по разу.
    rows = zip(
        formula_sheet.iter_rows(max_row=MAX_ROWS, max_col=MAX_COLS),
        value_sheet.iter_rows(max_row=MAX_ROWS, max_col=MAX_COLS),
    )

    for row_index, (formula_row, value_row) in enumerate(rows):
        for col_index, (formula_cell, value_cell) in enumerate(zip(formula_row, value_row)):
            raw = formula_cell.value
            if raw is None:
                continue

            if isinstance(raw, str) and raw.startswith("="):
                if _formula_supported(raw):
                    text = raw
                else:
                    # Незнакомая функция: лучше показать посчитанное Excel
                    # число, чем «#ИМЯ?». Но значение есть не всегда — Excel
                    # сохраняет его, только если книгу в нём открывали. Когда
                    # значения нет, переносим саму формулу: увидеть «#ИМЯ?»
                    # и поправить формулу можно, а пустую ячейку не вернуть.
                    text = _as_text(value_cell.value) or raw
            else:
                text = _as_text(raw)

            if text == "":
                continue
            cells[cell_ref(row_index, col_index)] = {"value": text, "display": text}

    return cells


def csv_to_book(data: bytes, *, name: str = "Лист1") -> dict:
    """Разделённый запятыми или точкой с запятой текст — в книгу."""
    text = _decode(data)
    if not text.strip():
        raise ImportError_("Файл пуст.")

    # Разделитель определяем по первой строке: в русской раскладке Excel
    # сохраняет CSV через точку с запятой, а не через запятую.
    head = text.split("\n", 1)[0]
    delimiter = ";" if head.count(";") > head.count(",") else ","

    cells: dict[str, dict] = {}
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    for row_index, row in enumerate(reader):
        if row_index >= MAX_ROWS:
            break
        for col_index, value in enumerate(row[:MAX_COLS]):
            value = value.strip()
            if not value:
                continue
            # Апостроф впереди ставим мы сами при выгрузке, помечая текст;
            # при обратном переносе его нужно убрать.
            if value.startswith("'"):
                value = value[1:]
            cells[cell_ref(row_index, col_index)] = {"value": value, "display": value}

    if not cells:
        raise ImportError_("В файле нет данных.")
    return {"kind": "sheet", "sheets": [{"id": "s1", "name": name[:50], "cells": cells}]}


# Подписи форматов в первых байтах файла.
_ZIP = b"PK\x03\x04"
_OLE2 = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"

SUPPORTED_EXTENSIONS = {"xlsx", "xlsm", "xls", "csv"}


def file_to_book(data: bytes, *, name: str) -> dict:
    """Книга из файла любого поддерживаемого вида.

    Расширение нужно только для имени листа у CSV: верить ему в выборе
    разборщика нельзя (см. начало модуля).
    """
    if not data:
        raise ImportError_("Файл пуст.")

    stem = name.rpartition(".")[0] or name or "Лист1"

    if data.startswith(_ZIP):
        return xlsx_to_book(data)
    if data.startswith(_OLE2):
        return xls_to_book(data)

    head = data[:2048].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    if head.startswith(b"<?xml") and b"urn:schemas-microsoft-com:office:spreadsheet" in data[:4096]:
        return spreadsheetml_to_book(data)
    if head.startswith(b"<") and (b"<table" in data[:200000].lower() or b"<html" in head):
        return html_to_book(data, name=stem)

    return csv_to_book(data, name=stem)


def xls_to_book(data: bytes) -> dict:
    """Двоичная книга Excel 97–2003.

    Формул xlrd не отдаёт — только посчитанные значения. Для переноса журнала
    этого достаточно: числа те же, что человек видел в Excel.
    """
    import xlrd

    try:
        workbook = xlrd.open_workbook(file_contents=data, on_demand=True)
    except Exception as error:  # noqa: BLE001 — xlrd кидает что угодно
        logger.warning("Не удалось разобрать книгу .xls: %s", error)
        raise ImportError_("Файл .xls повреждён или защищён паролем.") from error

    sheets = []
    try:
        for index in range(workbook.nsheets):
            source = workbook.sheet_by_index(index)
            cells: dict[str, dict] = {}
            for row in range(min(source.nrows, MAX_ROWS)):
                for col in range(min(source.ncols, MAX_COLS)):
                    text = _xls_cell_text(source.cell(row, col), workbook.datemode)
                    if text:
                        cells[cell_ref(row, col)] = {"value": text, "display": text}
            name = source.name[:50] or f"Лист{index + 1}"
            sheets.append({"id": f"s{index + 1}", "name": name, "cells": cells})
            workbook.unload_sheet(index)
    finally:
        workbook.release_resources()

    return _finish(sheets)


def _xls_cell_text(cell, datemode: int) -> str:
    import xlrd

    if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
        return ""
    if cell.ctype == xlrd.XL_CELL_ERROR:
        return xlrd.error_text_from_code.get(cell.value, "#ОШИБКА")
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return _as_text(bool(cell.value))
    if cell.ctype == xlrd.XL_CELL_DATE:
        try:
            moment = xlrd.xldate.xldate_as_datetime(cell.value, datemode)
        except (ValueError, OverflowError):
            return _as_text(cell.value)
        # Дробь меньше суток — это время без даты.
        if cell.value < 1:
            return _as_text(moment.time())
        return _as_text(moment)
    return _as_text(cell.value).strip()


def html_to_book(data: bytes, *, name: str = "Лист1") -> dict:
    """HTML-страница с таблицами: каждая таблица — отдельный лист."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(_decode_html(data), "lxml")
    tables = [table for table in soup.find_all("table") if not table.find_parent("table")]

    sheets = []
    for index, table in enumerate(tables):
        cells: dict[str, dict] = {}
        # Объединённые по вертикали ячейки занимают место в следующих строках:
        # без учёта этого данные ниже съехали бы на столбец влево.
        occupied: set[tuple[int, int]] = set()
        rows = [row for row in table.find_all("tr") if row.find_parent("table") is table]

        for row_index, row in enumerate(rows[:MAX_ROWS]):
            col_index = 0
            for cell in row.find_all(["td", "th"], recursive=False):
                while (row_index, col_index) in occupied:
                    col_index += 1
                span_cols = _span(cell.get("colspan"))
                span_rows = _span(cell.get("rowspan"))
                text = " ".join(cell.get_text(" ", strip=True).split())
                if text and col_index < MAX_COLS:
                    cells[cell_ref(row_index, col_index)] = {"value": text, "display": text}
                for extra_row in range(span_rows):
                    for extra_col in range(span_cols):
                        occupied.add((row_index + extra_row, col_index + extra_col))
                col_index += span_cols

        if cells:
            sheet_name = name if len(tables) == 1 else f"{name} {index + 1}"
            sheets.append({"id": f"s{len(sheets) + 1}", "name": sheet_name[:50], "cells": cells})

    if not sheets:
        raise ImportError_("В файле нет таблицы с данными.")
    return {"kind": "sheet", "sheets": sheets}


def _span(value) -> int:
    try:
        return max(1, min(int(value), MAX_COLS))
    except (TypeError, ValueError):
        return 1


def _decode_html(data: bytes) -> str:
    """Кодировка берётся из самой страницы: выгрузки из 1С бывают в cp1251."""
    match = re.search(rb"charset\s*=\s*[\"']?([\w-]+)", data[:4096], re.IGNORECASE)
    if match:
        try:
            return data.decode(match.group(1).decode("ascii"))
        except (LookupError, UnicodeDecodeError):
            pass
    return _decode(data)


_SS = "{urn:schemas-microsoft-com:office:spreadsheet}"


def spreadsheetml_to_book(data: bytes) -> dict:
    """XML-таблица Excel 2003 («Таблица XML 2003»)."""
    from lxml import etree

    try:
        # resolve_entities=False и no_network — файл пришёл от человека,
        # внешние сущности в нём не должны ничего подгружать.
        parser = etree.XMLParser(resolve_entities=False, no_network=True, huge_tree=False)
        root = etree.fromstring(data, parser=parser)
    except etree.XMLSyntaxError as error:
        raise ImportError_("Файл повреждён: XML не читается.") from error

    sheets = []
    for index, worksheet in enumerate(root.iter(f"{_SS}Worksheet")):
        cells: dict[str, dict] = {}
        row_index = -1
        for row in worksheet.iter(f"{_SS}Row"):
            # ss:Index — номер с единицы; пропущенные пустые строки не пишутся.
            row_index = _index(row, row_index + 1)
            if row_index >= MAX_ROWS:
                break
            col_index = -1
            for cell in row.iter(f"{_SS}Cell"):
                col_index = _index(cell, col_index + 1)
                data_node = cell.find(f"{_SS}Data")
                text = "".join(data_node.itertext()).strip() if data_node is not None else ""
                if text and col_index < MAX_COLS:
                    if data_node.get(f"{_SS}Type") == "DateTime":
                        text = _xml_datetime(text)
                    cells[cell_ref(row_index, col_index)] = {"value": text, "display": text}
                # Объединённая ячейка занимает и соседние столбцы.
                merge = cell.get(f"{_SS}MergeAcross") or ""
                if merge.isdigit():
                    col_index += int(merge)

        name = (worksheet.get(f"{_SS}Name") or f"Лист{index + 1}")[:50]
        sheets.append({"id": f"s{index + 1}", "name": name, "cells": cells})

    return _finish(sheets)


def _index(node, default: int) -> int:
    try:
        return int(node.get(f"{_SS}Index")) - 1
    except (TypeError, ValueError):
        return default


def _xml_datetime(text: str) -> str:
    try:
        return _as_text(datetime.fromisoformat(text))
    except ValueError:
        return text


def _finish(sheets: list[dict]) -> dict:
    if not sheets:
        raise ImportError_("В книге нет ни одного листа.")
    if not any(sheet["cells"] for sheet in sheets):
        raise ImportError_("В файле нет данных.")
    return {"kind": "sheet", "sheets": sheets}


def _decode(data: bytes) -> str:
    """Текст из байтов. Windows-1251 встречается в выгрузках из 1С."""
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("Не удалось определить кодировку файла.")
