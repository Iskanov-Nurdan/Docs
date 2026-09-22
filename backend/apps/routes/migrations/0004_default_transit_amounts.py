"""Начальные суммы транзита — те же, что таблица предлагала до справочника.

Без них после обновления список стал бы пустым, и в уже заведённых журналах
транзит вдруг перестал бы предлагаться. Администратор дальше правит список сам.
"""
from decimal import Decimal

from django.db import migrations

DEFAULTS = [Decimal("200"), Decimal("300"), Decimal("500")]


def add_defaults(apps, schema_editor):
    TransitAmount = apps.get_model("routes", "TransitAmount")
    if TransitAmount.objects.exists():
        return
    for amount in DEFAULTS:
        # Порядок не задаём: суммы идут по возрастанию, и новая встаёт
        # на своё место сама, а не в конец списка.
        TransitAmount.objects.create(amount=amount)


def drop_defaults(apps, schema_editor):
    TransitAmount = apps.get_model("routes", "TransitAmount")
    TransitAmount.objects.filter(amount__in=DEFAULTS).delete()


class Migration(migrations.Migration):
    dependencies = [("routes", "0003_transitamount")]
    operations = [migrations.RunPython(add_defaults, drop_defaults)]
