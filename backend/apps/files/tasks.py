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
    "csv": "text/csv; charset=utf-8",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}


@shared_task(bind=True, max_retries=2, default_retry_delay=30)
def export_document(self, document_id: str, export_format: str, user_id: str) -> dict:
    from apps.documents.models import Document
    from apps.files.converters import (
        html_to_pdf, sheet_to_csv, sheet_to_docx, sheet_to_html, sheet_to_text, sheet_to_xlsx,
    )
    from apps.files.models import StoredFile
    from apps.users.models import User

    document = Document.objects.filter(id=document_id).first()
    if document is None:
        return {"error": "document_not_found"}

    user = User.objects.filter(id=user_id).first()
    safe_name = "".join(ch for ch in document.title if ch.isalnum() or ch in " -_")[:80].strip()
    safe_name = safe_name or "document"

    try:
        if export_format == "csv":
            payload = sheet_to_csv(document.content).encode("utf-8-sig")
        elif export_format == "xlsx":
            payload = sheet_to_xlsx(document.content, title=document.title)
        elif export_format == "txt":
            payload = sheet_to_text(document.content).encode("utf-8")
        elif export_format == "docx":
            payload = sheet_to_docx(document.content, title=document.title)
        elif export_format == "pdf":
            payload = html_to_pdf(sheet_to_html(document.content, title=document.title))
        elif export_format == "html":
            payload = sheet_to_html(document.content, title=document.title).encode("utf-8")
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
