"""Фоновая подготовка файлов: выгрузка и разбор загруженных документов."""
import logging
from datetime import timedelta

from celery import shared_task
from django.core.files.base import ContentFile
from django.utils import timezone

logger = logging.getLogger(__name__)

# Готовый файл живёт сутки: за это время его успевают скачать, а хранилище
# не забивается выгрузками.
EXPORT_TTL = timedelta(days=1)

CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain; charset=utf-8",
    "html": "text/html; charset=utf-8",
    "rtf": "application/rtf",
    "odt": "application/vnd.oasis.opendocument.text",
}


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def export_document(self, document_id: str, export_format: str, user_id: str) -> dict:
    from apps.documents.models import Document
    from apps.files.converters import document_to_docx, document_to_html, document_to_text, html_to_pdf
    from apps.files.models import StoredFile
    from apps.users.models import User

    document = Document.objects.filter(id=document_id).first()
    if document is None:
        return {"error": "document_not_found"}

    user = User.objects.filter(id=user_id).first()
    safe_name = "".join(ch for ch in document.title if ch.isalnum() or ch in " -_")[:80].strip()
    safe_name = safe_name or "document"

    try:
        if export_format == "pdf":
            payload = html_to_pdf(document_to_html(document.content, title=document.title))
        elif export_format == "docx":
            payload = document_to_docx(document.content, title=document.title)
        elif export_format == "txt":
            payload = document_to_text(document.content).encode("utf-8")
        elif export_format in {"html", "rtf", "odt"}:
            # RTF и ODT собираются из той же разметки: оба формата её понимают,
            # а отдельные генераторы дали бы расхождение в оформлении.
            payload = document_to_html(document.content, title=document.title).encode("utf-8")
        else:
            return {"error": "unknown_format"}
    except Exception as exc:  # noqa: BLE001 — сбой конвертера не должен ронять очередь
        logger.exception("Не удалось выгрузить документ %s в %s", document_id, export_format)
        raise self.retry(exc=exc)

    stored = StoredFile.objects.create(
        kind=StoredFile.Kind.EXPORT,
        original_name=f"{safe_name}.{export_format}",
        content_type=CONTENT_TYPES.get(export_format, "application/octet-stream"),
        size=len(payload),
        uploaded_by=user,
        document=document,
        expires_at=timezone.now() + EXPORT_TTL,
    )
    stored.file.save(f"{safe_name}.{export_format}", ContentFile(payload), save=True)

    logger.info("Документ %s выгружен в %s (%s байт)", document_id, export_format, len(payload))
    return {"file_id": str(stored.id), "format": export_format}


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def import_document(self, stored_file_id: str, user_id: str) -> dict:
    from apps.documents.services import DocumentService
    from apps.files.converters import docx_to_document, text_to_document
    from apps.files.models import StoredFile
    from apps.users.models import User

    stored = StoredFile.objects.filter(id=stored_file_id).first()
    user = User.objects.filter(id=user_id).first()
    if stored is None or user is None:
        return {"error": "not_found"}

    title = stored.original_name.rsplit(".", 1)[0][:255] or "Импортированный документ"

    try:
        with stored.file.open("rb") as handle:
            if stored.content_type.endswith("wordprocessingml.document"):
                content = docx_to_document(handle)
            else:
                # Кодировку угадывать не пытаемся: подменённые символы хуже,
                # чем честный отказ, но utf-8 покрывает подавляющее большинство.
                content = text_to_document(handle.read().decode("utf-8", errors="replace"))
    except Exception as exc:  # noqa: BLE001
        logger.exception("Не удалось разобрать файл %s", stored_file_id)
        raise self.retry(exc=exc)

    document = DocumentService().create(user=user, title=title, content=content)

    from apps.documents.models import DocumentActivity

    DocumentService().log(document=document, user=user,
                          action=DocumentActivity.Action.IMPORTED,
                          metadata={"source": stored.original_name})
    logger.info("Импортирован документ %s из файла %s", document.id, stored_file_id)
    return {"document_id": str(document.id)}
