"""Готовые таблицы: журнал рейсов, заказы и долги.

Шаблоны заводятся миграцией, а не руками в админке: иначе на новом сервере
галерея пуста, и человеку приходится строить журнал рейсов с нуля.

Колонки подобраны так, чтобы столбец «Статус» заполнялся словами, которые
таблица красит сама: «Просрочка» — красным, «Налог» — оранжевым, «В пути» —
синим (см. frontend/src/spreadsheet/statuses.ts).
"""
from django.db import migrations


def cells(rows: list[list[str]]) -> dict:
    """Список строк — в разреженные ячейки: пустые в книге не хранятся."""
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    result = {}
    for row_index, row in enumerate(rows, start=1):
        for col_index, value in enumerate(row):
            if value == "":
                continue
            result[f"{letters[col_index]}{row_index}"] = {"value": value, "display": value}
    return result


def book(name: str, rows: list[list[str]]) -> dict:
    return {"kind": "sheet", "sheets": [{"id": "s1", "name": name, "cells": cells(rows)}]}


# «Прибытие» — колонка со сроком: когда указанное время проходит, ячейка
# краснеет сама, если строка ещё не закрыта. Поэтому в примерах даты
# относительные — иначе шаблон краснел бы весь и сразу.
TRIPS = book("Рейсы", [
    ["Дата", "Машина", "Водитель", "Откуда", "Куда", "Вышел", "Прибытие", "Груз",
     "Сумма", "Налог", "Статус", "Примечание"],
    ["=СЕГОДНЯ()", "01KG777AAA", "Асан", "Бишкек", "Ош", "08:30", "18:00", "Ткань",
     "128400", "Налог", "В пути", ""],
    ["=СЕГОДНЯ()", "01KG512BBB", "Нурлан", "Ош", "Бишкек", "07:00", "23:30", "Фурнитура",
     "96000", "", "В пути", ""],
    ["=СЕГОДНЯ()", "01KG903CCC", "Данияр", "Бишкек", "Каракол", "09:15", "16:40", "Обувь",
     "54000", "", "Готово", "Приехал вовремя"],
])

ORDERS = book("Заказы", [
    ["Номер", "Дата", "Контрагент", "Товар", "Кол-во", "Цена", "Сумма", "Оплата", "Статус"],
    ["СЧ-4501", "01.09.2026", "Текстиль Юг", "Ткань", "120", "450", "=E2*F2", "Оплачено", "Готово"],
    ["СЧ-4502", "02.09.2026", "Ткани Оптом", "Фурнитура", "80", "1200", "=E3*F3", "Не оплачено",
     "Ожидание"],
    ["", "", "", "", "", "Итого", "=СУММ(G2:G3)", "", ""],
])

DEBTS = book("Долги", [
    ["Контрагент", "Счёт", "Сумма", "Оплачено", "Остаток", "Срок", "Статус"],
    ["Текстиль Юг", "СЧ-4501", "128400", "128400", "=C2-D2", "10.09.2026", "Оплачено"],
    ["Ткани Оптом", "СЧ-4502", "96000", "40000", "=C3-D3", "05.09.2026", "Просрочка"],
    ["", "", "=СУММ(C2:C3)", "=СУММ(D2:D3)", "=СУММ(E2:E3)", "", ""],
])


TEMPLATES = [
    {
        "title": "Журнал рейсов",
        "description": "Кто, куда и во сколько вышел. Просрочка красится красным, налог — оранжевым.",
        "content": TRIPS,
        "order": 10,
    },
    {
        "title": "Заказы",
        "description": "Счета с суммой и оплатой. Итог считается формулой.",
        "content": ORDERS,
        "order": 20,
    },
    {
        "title": "Долги",
        "description": "Остаток по каждому контрагенту и срок оплаты.",
        "content": DEBTS,
        "order": 30,
    },
]


def add_templates(apps, schema_editor):
    DocumentTemplate = apps.get_model("doc_templates", "DocumentTemplate")
    for item in TEMPLATES:
        DocumentTemplate.objects.update_or_create(
            title=item["title"],
            defaults={
                "description": item["description"],
                "category": "business",
                "content": item["content"],
                "is_building_block": False,
                "is_active": True,
                "order": item["order"],
            },
        )


def drop_templates(apps, schema_editor):
    DocumentTemplate = apps.get_model("doc_templates", "DocumentTemplate")
    DocumentTemplate.objects.filter(title__in=[item["title"] for item in TEMPLATES]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("doc_templates", "0002_initial"),
    ]

    operations = [
        migrations.RunPython(add_templates, drop_templates),
    ]
