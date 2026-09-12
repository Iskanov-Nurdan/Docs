"""Удаление документов прежнего текстового редактора.

Данные и схема разведены по разным миграциям, чтобы удаление записей и
перестройка таблицы не попали в одну транзакцию: на большой таблице это
держит блокировку заметно дольше, чем нужно.

Внимание: под удаление попадают все документы с doc_type="text", а поле это
появилось в 0003 со значением по умолчанию "text" — то есть каждый документ,
заведённый до неё. Выгрузка сделана заранее: backups/legacy-text-documents.json.

Откат восстанавливает схему, но не данные: их в базе уже нет. Раньше обратная
операция бросала исключение, и откатить релиз было нельзя в принципе —
застрявшая миграция мешала больше, чем отсутствие автоматического возврата.
"""
from django.db import migrations


def drop_text_documents(apps, schema_editor):
    Document = apps.get_model("documents", "Document")
    deleted, _ = Document.objects.filter(doc_type="text").delete()
    print(f"  удалено записей вместе с текстовыми документами: {deleted}")


def restore_manually(apps, schema_editor):
    print(
        "  ВНИМАНИЕ: текстовые документы этой миграцией не возвращаются. "
        "Восстановление — вручную из выгрузки backups/legacy-text-documents.json."
    )


class Migration(migrations.Migration):

    dependencies = [
        ("documents", "0004_search_trigram"),
    ]

    operations = [
        migrations.RunPython(drop_text_documents, restore_manually),
    ]
