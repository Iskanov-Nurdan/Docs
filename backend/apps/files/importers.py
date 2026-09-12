"""Перенос таблицы из файла в книгу.

Обратная сторона converters.py: там книга превращается в файл, здесь файл —
в книгу. Поддерживаются .xlsx, .xlsm и .csv: именно их присылают, когда
таблицу вели в Excel и хотят продолжить здесь.

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

# Пределы листа в редакторе (frontend/src/spreadsheet/model.ts). Файл крупнее
# обрезается: строки за границей всё равно негде показать.
MAX_ROWS = 5000
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


def _decode(data: bytes) -> str:
    """Текст из байтов. Windows-1251 встречается в выгрузках из 1С."""
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ImportError_("Не удалось определить кодировку файла.")
