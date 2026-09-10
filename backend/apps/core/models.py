"""Общие модели-основы."""
import uuid

from django.db import models


class TimeStampedModel(models.Model):
    """Даты создания и изменения — нужны почти каждой сущности."""

    created_at = models.DateTimeField("Создано", auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField("Изменено", auto_now=True)

    class Meta:
        abstract = True


class UUIDModel(models.Model):
    """Идентификатор в URL документа не должен раскрывать их количество."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    class Meta:
        abstract = True
