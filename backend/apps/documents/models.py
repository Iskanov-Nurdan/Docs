"""Документы и папки.

Содержимое хранится в двух видах, и это осознанно:

* `ydoc_state` — двоичное состояние Yjs. Оно авторитетно при совместном
  редактировании: только CRDT умеет слить правки двух людей в один участок
  текста, не потеряв ни одну из них.
* `content` — та же книга обычным JSON: листы, ячейки, посчитанные значения.
  Нужна всему, что работает без редактора: поиск, экспорт, версии, публикация.
  Пересобирается из состояния Yjs, а не правится напрямую.

Хранить только JSON и перезаписывать его целиком нельзя: при одновременной
правке победил бы тот, кто сохранил последним.
"""
from django.contrib.postgres.indexes import GinIndex, OpClass
from django.contrib.postgres.search import SearchVectorField
from django.db import models
from django.db.models.functions import Upper

from apps.core.models import TimeStampedModel, UUIDModel


class Folder(UUIDModel, TimeStampedModel):
    """Папка пользователя. Вложенность произвольной глубины."""

    name = models.CharField("Название", max_length=120)
    owner = models.ForeignKey("users.User", verbose_name="Владелец", on_delete=models.CASCADE,
                              related_name="folders")
    parent = models.ForeignKey("self", verbose_name="Родительская папка", on_delete=models.CASCADE,
                               null=True, blank=True, related_name="children")
    deleted_at = models.DateTimeField("Удалена", null=True, blank=True, db_index=True)

    class Meta:
        db_table = "folders"
        verbose_name = "Папка"
        verbose_name_plural = "Папки"
        ordering = ("name",)
        indexes = [models.Index(fields=["owner", "parent"])]

    def __str__(self):
        return self.name


class Document(UUIDModel, TimeStampedModel):
    title = models.CharField("Название", max_length=255, default="Без названия")
    owner = models.ForeignKey("users.User", verbose_name="Владелец", on_delete=models.CASCADE,
                              related_name="documents")
    folder = models.ForeignKey(Folder, verbose_name="Папка", on_delete=models.SET_NULL,
                               null=True, blank=True, related_name="documents")

    content = models.JSONField("Содержимое", default=dict, blank=True)
    # Пустой при создании: состояние появляется с первой правкой в редакторе.
    ydoc_state = models.BinaryField("Состояние Yjs", null=True, blank=True, editable=False)
    # Обычный текст для поиска и предпросмотра — вынут из content при сохранении.
    plain_text = models.TextField("Текст для поиска", blank=True, editable=False)
    search_vector = SearchVectorField("Поисковый вектор", null=True, editable=False)

    is_published = models.BooleanField("Опубликован", default=False, db_index=True)
    deleted_at = models.DateTimeField("Удалён", null=True, blank=True, db_index=True)

    # Владелец может запретить эти действия всем, кроме себя.
    allow_download = models.BooleanField("Разрешить скачивание", default=True)
    allow_copy = models.BooleanField("Разрешить копирование", default=True)
    allow_print = models.BooleanField("Разрешить печать", default=True)

    last_edited_by = models.ForeignKey("users.User", verbose_name="Последний редактор",
                                       on_delete=models.SET_NULL, null=True, blank=True,
                                       related_name="edited_documents")
    last_edited_at = models.DateTimeField("Последнее изменение", null=True, blank=True,
                                          db_index=True)

    class Meta:
        db_table = "documents"
        verbose_name = "Документ"
        verbose_name_plural = "Документы"
        ordering = ("-last_edited_at", "-created_at")
        indexes = [
            models.Index(fields=["owner", "deleted_at"]),
            models.Index(fields=["owner", "-last_edited_at"]),
            GinIndex(fields=["search_vector"], name="documents_search_gin"),
            # Триграммные индексы — под поиск по части слова и части номера:
            # «450» должно находить «СЧ-4501-А». Полнотекстовый индекс ищет
            # словами целиком и такого не умеет.
            GinIndex(OpClass(Upper("title"), name="gin_trgm_ops"), name="documents_title_trgm"),
            GinIndex(OpClass(Upper("plain_text"), name="gin_trgm_ops"),
                     name="documents_text_trgm"),
        ]

    def __str__(self):
        return self.title

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None

    @property
    def preview(self) -> str:
        """Первые строки для карточки в списке."""
        return self.plain_text[:200]


class StarredDocument(TimeStampedModel):
    """Избранное — своё у каждого, а не свойство документа."""

    user = models.ForeignKey("users.User", verbose_name="Пользователь", on_delete=models.CASCADE,
                             related_name="starred")
    document = models.ForeignKey(Document, verbose_name="Документ", on_delete=models.CASCADE,
                                 related_name="starred_by")

    class Meta:
        db_table = "documents_starred"
        verbose_name = "Избранный документ"
        verbose_name_plural = "Избранные документы"
        constraints = [
            models.UniqueConstraint(fields=("user", "document"), name="uniq_star_per_user"),
        ]


class DocumentActivity(TimeStampedModel):
    """Журнал действий с документом: кто, что и когда сделал."""

    class Action(models.TextChoices):
        CREATED = "created", "Создан"
        OPENED = "opened", "Открыт"
        EDITED = "edited", "Изменён"
        SHARED = "shared", "Доступ изменён"
        COMMENTED = "commented", "Прокомментирован"
        RENAMED = "renamed", "Переименован"
        MOVED = "moved", "Перемещён"
        DELETED = "deleted", "Удалён"
        RESTORED = "restored", "Восстановлен"
        PUBLISHED = "published", "Опубликован"
        DOWNLOADED = "downloaded", "Скачан"
        PRINTED = "printed", "Отправлен на печать"
        IMPORTED = "imported", "Импортирован"
        COPIED = "copied", "Скопирован"

    document = models.ForeignKey(Document, verbose_name="Документ", on_delete=models.CASCADE,
                                 related_name="activities")
    user = models.ForeignKey("users.User", verbose_name="Пользователь", on_delete=models.SET_NULL,
                             null=True, blank=True, related_name="document_activities")
    action = models.CharField("Действие", max_length=20, choices=Action.choices, db_index=True)
    metadata = models.JSONField("Подробности", default=dict, blank=True)
    ip_address = models.GenericIPAddressField("IP-адрес", null=True, blank=True)

    class Meta:
        db_table = "document_activities"
        verbose_name = "Действие с документом"
        verbose_name_plural = "Действия с документами"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["document", "-created_at"])]


# Журнал приращений CRDT вынесен отдельным модулем: он про механику
# совместного редактирования, а не про свойства документа.
from apps.documents.crdt_models import DocumentUpdate  # noqa: E402,F401
