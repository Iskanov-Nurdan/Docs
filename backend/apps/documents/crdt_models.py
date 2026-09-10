"""Хранение правок CRDT.

Yjs присылает правки двоичными приращениями. Сервер их не разбирает — он
дописывает их в журнал и раздаёт остальным участникам. Это важное свойство
CRDT: приращения можно применять в любом порядке и по многу раз, результат
у всех получится одинаковый.

Почему журнал, а не одно поле с состоянием: чтобы записать состояние целиком,
сервер должен был бы уметь сливать правки, то есть тащить реализацию Yjs на
Python. Вместо этого он копит приращения, а участник, у которого документ
открыт, время от времени присылает свёрнутое состояние — тогда журнал
очищается. Документ, который никто не открывал, остаётся в снимке.
"""
from django.db import models

from apps.core.models import TimeStampedModel


class DocumentUpdate(TimeStampedModel):
    """Одно двоичное приращение Yjs."""

    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, related_name="updates")
    payload = models.BinaryField("Приращение", editable=False)
    author = models.ForeignKey("users.User", verbose_name="Автор", on_delete=models.SET_NULL,
                               null=True, blank=True, related_name="document_updates")

    class Meta:
        db_table = "document_updates"
        verbose_name = "Приращение документа"
        verbose_name_plural = "Приращения документов"
        ordering = ("created_at", "id")
        indexes = [models.Index(fields=["document", "created_at"])]
