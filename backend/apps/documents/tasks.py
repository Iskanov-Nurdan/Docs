"""Фоновые задачи документов."""
import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)

# Сколько документ лежит в корзине до безвозвратного удаления.
TRASH_TTL = timedelta(days=30)


@shared_task
def purge_trash():
    """Очистка корзины. Удаляет только то, что пролежало дольше срока."""
    from apps.documents.models import Document

    deadline = timezone.now() - TRASH_TTL
    queryset = Document.objects.filter(deleted_at__isnull=False, deleted_at__lt=deadline)
    count = queryset.count()
    queryset.delete()
    logger.info("Корзина очищена: удалено документов — %s", count)
    return count


@shared_task
def cleanup_expired_files():
    """Удаление просроченных выгрузок: хранилище не должно расти без границ."""
    from apps.files.models import StoredFile

    expired = StoredFile.objects.filter(expires_at__isnull=False, expires_at__lt=timezone.now())
    count = 0
    for stored in expired:
        stored.file.delete(save=False)
        stored.delete()
        count += 1
    logger.info("Удалено просроченных файлов: %s", count)
    return count
