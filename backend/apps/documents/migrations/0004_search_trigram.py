"""Поиск по части слова и по части номера.

Полнотекстовый индекс ищет целыми словами: по «4501» он находит документ,
где есть ровно 4501, но не находит 4501-А и не находит по «450». Для поиска
по фрагменту нужен другой индекс — триграммный.
"""
from django.contrib.postgres.indexes import GinIndex, OpClass
from django.contrib.postgres.operations import TrigramExtension
from django.db import migrations
from django.db.models.functions import Upper


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0003_document_doc_type"),
    ]

    operations = [
        TrigramExtension(),
        migrations.AddIndex(
            model_name="document",
            index=GinIndex(
                OpClass(Upper("title"), name="gin_trgm_ops"),
                name="documents_title_trgm",
            ),
        ),
        migrations.AddIndex(
            model_name="document",
            index=GinIndex(
                OpClass(Upper("plain_text"), name="gin_trgm_ops"),
                name="documents_text_trgm",
            ),
        ),
    ]
