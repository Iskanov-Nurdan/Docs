"""Публикация документа в вебе."""
from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class PublishedDocument(UUIDModel, TimeStampedModel):
    """Опубликованная копия документа.

    Содержимое хранится отдельным снимком: публикация не должна показывать
    правки, сделанные после неё, пока автор не обновит её сам. Иначе черновая
    правка мгновенно уходила бы всем, кто открыл публичную ссылку.
    """

    document = models.OneToOneField("documents.Document", verbose_name="Документ",
                                    on_delete=models.CASCADE, related_name="publication")
    public_id = models.CharField("Публичный адрес", max_length=64, unique=True, db_index=True)
    content = models.JSONField("Опубликованное содержимое", default=dict)
    title = models.CharField("Заголовок", max_length=255)
    is_active = models.BooleanField("Доступна", default=True, db_index=True)
    auto_update = models.BooleanField("Обновлять автоматически", default=False)
    views_count = models.PositiveBigIntegerField("Просмотров", default=0)
    published_by = models.ForeignKey("users.User", verbose_name="Опубликовал",
                                     on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name="publications")

    class Meta:
        db_table = "published_documents"
        verbose_name = "Публикация"
        verbose_name_plural = "Публикации"

    def __str__(self):
        return self.title
