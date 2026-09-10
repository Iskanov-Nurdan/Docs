"""Фоновые снимки версий."""
import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

# Снимок делается для документов, которые правили за последний час: история
# не должна зависеть от того, вспомнил ли человек сохранить версию.
SNAPSHOT_WINDOW = timedelta(hours=1)


@shared_task
def snapshot_active_documents():
    from apps.documents.models import Document
    from apps.versions.models import DocumentVersion
    from apps.versions.services import VersionService

    since = timezone.now() - SNAPSHOT_WINDOW
    documents = Document.objects.filter(last_edited_at__gte=since, deleted_at__isnull=True)

    service = VersionService()
    created = 0
    for document in documents:
        last = DocumentVersion.objects.filter(document=document).order_by("-version_number").first()
        # Ничего не изменилось с прошлого снимка — новая версия не нужна.
        if last and last.content == document.content:
            continue
        service.create_snapshot(document=document, label="Автоматический снимок",
                                metadata={"reason": "scheduled"})
        created += 1

    logger.info("Автоснимки версий: создано %s", created)
    return created
