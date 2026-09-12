"""Документ — всегда книга таблицы.

Вид документа и параметры печатного листа принадлежали текстовому редактору,
которого больше нет: страница A4, поля и ориентация к сетке ячеек отношения
не имеют.
"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0005_drop_text_documents"),
    ]

    operations = [
        migrations.RemoveField(model_name="document", name="doc_type"),
        migrations.RemoveField(model_name="document", name="document_mode"),
        migrations.RemoveField(model_name="document", name="page_size"),
        migrations.RemoveField(model_name="document", name="orientation"),
        migrations.RemoveField(model_name="document", name="margin_top"),
        migrations.RemoveField(model_name="document", name="margin_bottom"),
        migrations.RemoveField(model_name="document", name="margin_left"),
        migrations.RemoveField(model_name="document", name="margin_right"),
        migrations.RemoveField(model_name="document", name="page_color"),
    ]
