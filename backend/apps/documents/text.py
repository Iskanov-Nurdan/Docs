"""Разбор содержимого книги.

Документ — это листы с ячейками. Здесь то, что нужно серверу и чего нет
в самой книге: обычный текст для поиска и подсчёт заполненного.
"""
from typing import Any

MAX_TEXT_LENGTH = 1_000_000


def extract_plain_text(content: Any, limit: int = MAX_TEXT_LENGTH) -> str:
    """Текст книги для поиска: названия листов и значения ячеек.

    В поиск идёт и введённое, и посчитанное: номер счёта человек ищет как
    «4501», а в ячейке может лежать формула, дающая это число. Оба значения
    приходят с клиента — сервер формулы не считает.
    """
    if not isinstance(content, dict):
        return ""

    parts: list[str] = []
    length = 0

    for sheet in content.get("sheets") or []:
        if not isinstance(sheet, dict):
            continue

        name = str(sheet.get("name") or "")
        if name:
            parts.append(name)
            length += len(name) + 1

        cells = sheet.get("cells")
        # Содержимое могло попасть в базу до того, как разбор стал строгим:
        # падать на нём нельзя — переиндексация идёт внутри транзакции записи.
        if not isinstance(cells, dict):
            continue

        for cell in cells.values():
            if length >= limit:
                break

            if isinstance(cell, dict):
                values = [cell.get("value"), cell.get("display")]
            else:
                values = [cell]

            for value in values:
                if value in (None, ""):
                    continue
                text = str(value)
                # Формула и её результат совпадают у обычного числа —
                # второй раз то же самое в индекс не кладём.
                if parts and parts[-1] == text:
                    continue
                parts.append(text)
                length += len(text) + 1

    return "\n".join(parts)[:limit].strip()


def count_stats(content: Any) -> dict:
    """Сводка по книге — показывается в свойствах документа."""
    sheets = content.get("sheets") if isinstance(content, dict) else None
    sheets = sheets if isinstance(sheets, list) else []

    filled = 0
    formulas = 0
    for sheet in sheets:
        if not isinstance(sheet, dict):
            continue
        cells = sheet.get("cells")
        if not isinstance(cells, dict):
            continue

        for cell in cells.values():
            value = cell.get("value") if isinstance(cell, dict) else cell
            if value in (None, ""):
                continue
            filled += 1
            if str(value).startswith("="):
                formulas += 1

    text = extract_plain_text(content)
    return {
        "sheets": len(sheets),
        "cells": filled,
        "formulas": formulas,
        "characters": len(text),
    }
