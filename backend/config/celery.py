"""Celery: экспорт, импорт, письма, снимки версий, очистка корзины."""
import os

from celery import Celery
from celery.schedules import crontab

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

app = Celery("docs")
app.config_from_object("django.conf:settings", namespace="CELERY")
app.autodiscover_tasks()

app.conf.beat_schedule = {
    # Корзина не должна расти бесконечно: документы старше 30 дней удаляются.
    "purge-trash-daily": {
        "task": "apps.documents.tasks.purge_trash",
        "schedule": crontab(hour=3, minute=30),
    },
    # Снимок версии раз в час — чтобы история не зависела от того,
    # закрыл ли пользователь вкладку.
    "snapshot-active-documents": {
        "task": "apps.versions.tasks.snapshot_active_documents",
        "schedule": crontab(minute=0),
    },
}
