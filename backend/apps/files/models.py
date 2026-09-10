"""Файлы: изображения документов, вложения, результаты экспорта и импорта."""
from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class StoredFile(UUIDModel, TimeStampedModel):
    """Файл лежит в объектном хранилище; в базе — только метаданные и ключ."""

    class Kind(models.TextChoices):
        IMAGE = "image", "Изображение"
        ATTACHMENT = "attachment", "Вложение"
        EXPORT = "export", "Выгрузка"
        IMPORT = "import", "Загруженный файл"
        AVATAR = "avatar", "Фотография профиля"

    kind = models.CharField("Тип", max_length=12, choices=Kind.choices, db_index=True)
    file = models.FileField("Файл", upload_to="uploads/%Y/%m/")
    original_name = models.CharField("Исходное имя", max_length=255)
    content_type = models.CharField("MIME-тип", max_length=100)
    size = models.PositiveBigIntegerField("Размер, байт")
    width = models.PositiveIntegerField("Ширина", null=True, blank=True)
    height = models.PositiveIntegerField("Высота", null=True, blank=True)

    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, null=True, blank=True,
                                 related_name="files")
    uploaded_by = models.ForeignKey("users.User", verbose_name="Загрузил",
                                    on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="uploaded_files")
    # Выгрузки живут ограниченное время: хранилище не должно расти без границ.
    expires_at = models.DateTimeField("Удалить после", null=True, blank=True, db_index=True)

    class Meta:
        db_table = "stored_files"
        verbose_name = "Файл"
        verbose_name_plural = "Файлы"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["document", "kind"])]

    def __str__(self):
        return self.original_name
