"""Шаблон «Груз из Китая»: рейс, деньги и растаможка в одной таблице.

Отдельно от простого журнала рейсов (миграция 0003), а не вместо него: там
перевозка внутри страны, здесь — закуп с оплатой в юанях и таможней. Смешивать
их в одной таблице нельзя, половина колонок всё время пустовала бы.

Колонки названы так, чтобы таблица помогала сама:

* «Прибытие» — колонка срока: когда время прошло, а строка не закрыта, ячейка
  краснеет без чьей-либо правки;
* «Статус», «Оплата», «Таможня» заполняются словами, которые красятся по
  смыслу: «В пути» — синим, «Не оплачено» — красным, «Налог» — оранжевым
  (см. frontend/src/spreadsheet/statuses.ts);
* «Курс» стоит в каждой строке, а не одной ячейкой над таблицей: курс разный
  для разных закупов, да и шапка должна оставаться первой строкой — по ней
  собирается форма добавления записи.
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


# Даты относительные: с жёсткими шаблон краснел бы весь и сразу.
CHINA = book("Грузы", [
    ["Дата", "Машина", "Водитель", "Поставщик", "Откуда", "Куда", "Груз",
     "Мест", "Вес, кг", "Сумма ¥", "Курс", "Сумма сом", "Таможня",
     "Вышел", "Прибытие", "Оплата", "Статус", "Примечание"],
    ["=СЕГОДНЯ()", "01KG777AAA", "Асан", "Guangzhou Textile", "Урумчи", "Бишкек", "Ткань",
     "40", "8200", "12000", "12.3", "=J2*K2", "Налог",
     "08:30", "23:30", "Не оплачено", "В пути", ""],
    ["=СЕГОДНЯ()", "01KG512BBB", "Нурлан", "Yiwu Trading", "Кашгар", "Ош", "Фурнитура",
     "25", "3100", "4800", "12.3", "=J3*K3", "",
     "07:00", "21:00", "Оплачено", "В пути", ""],
    ["=СЕГОДНЯ()", "01KG903CCC", "Данияр", "Shenzhen Shoes", "Урумчи", "Бишкек", "Обувь",
     "60", "9400", "18500", "12.1", "=J4*K4", "Налог",
     "09:15", "16:40", "Оплачено", "Готово", "Растаможен"],
    ["", "", "", "", "", "", "Итого",
     "=СУММ(H2:H4)", "=СУММ(I2:I4)", "=СУММ(J2:J4)", "", "=СУММ(L2:L4)", "",
     "", "", "", "", ""],
])


TEMPLATE = {
    "title": "Груз из Китая",
    "description": "Закуп с оплатой в юанях, растаможкой и сроком прибытия. "
                   "Сомы и итоги считаются формулами, просрочка краснеет сама.",
    "content": CHINA,
    "order": 15,
}


def add_template(apps, schema_editor):
    DocumentTemplate = apps.get_model("doc_templates", "DocumentTemplate")
    DocumentTemplate.objects.update_or_create(
        title=TEMPLATE["title"],
        defaults={
            "description": TEMPLATE["description"],
            "category": "business",
            "content": TEMPLATE["content"],
            "is_building_block": False,
            "is_active": True,
            "order": TEMPLATE["order"],
        },
    )


def drop_template(apps, schema_editor):
    DocumentTemplate = apps.get_model("doc_templates", "DocumentTemplate")
    DocumentTemplate.objects.filter(title=TEMPLATE["title"]).delete()


class Migration(migrations.Migration):

    dependencies = [
        ("doc_templates", "0003_sheet_templates"),
    ]

    operations = [
        migrations.RunPython(add_template, drop_template),
    ]
