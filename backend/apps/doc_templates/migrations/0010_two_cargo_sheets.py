"""New cargo templates have separate in-transit and delivered ledgers.

Existing documents are deliberately untouched: they can contain live cargo data.
"""
from django.db import migrations


HEADERS = [
    "Дата", "Машина", "Водитель", "Груз", "Откуда", "Куда", "Вес, кг",
    "Стоимость, $", "Налог, $", "Транзит, $", "Статус", "Примечание",
]


def sheet(sheet_id, name):
    cells = {}
    for col, value in enumerate(HEADERS):
        letters = chr(ord("A") + col)
        cells[f"{letters}1"] = {"value": value, "display": value}
    return {"id": sheet_id, "name": name, "cells": cells}


CONTENT = {
    "kind": "sheet",
    "sheets": [
        sheet("in-transit", "В пути"),
        sheet("delivered", "Груз доставлен"),
    ],
}


def update_templates(apps, schema_editor):
    Template = apps.get_model("doc_templates", "DocumentTemplate")
    Template.objects.filter(title__in=("Журнал рейсов", "Груз из Китая")).update(
        content=CONTENT,
        description="Два листа: «В пути» и «Груз доставлен». Ведите по каждому грузу сумму, налог и транзит — бухгалтерская сводка посчитает заполненные значения.",
    )


class Migration(migrations.Migration):
    dependencies = [("doc_templates", "0009_passed_column")]

    operations = [migrations.RunPython(update_templates, migrations.RunPython.noop)]
