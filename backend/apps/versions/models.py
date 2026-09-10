"""История версий документа."""
from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class DocumentVersion(UUIDModel, TimeStampedModel):
    """Снимок документа.

    Восстановление старой версии не удаляет ничего: поверх истории ложится
    новая версия с прежним содержимым. Иначе «откатился и передумал» стоил бы
    пользователю всей работы.
    """

    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, related_name="versions")
    user = models.ForeignKey("users.User", verbose_name="Автор изменений",
                             on_delete=models.SET_NULL, null=True, blank=True,
                             related_name="document_versions")
    version_number = models.PositiveIntegerField("Номер версии")
    content = models.JSONField("Содержимое", default=dict)
    ydoc_state = models.BinaryField("Состояние Yjs", null=True, blank=True, editable=False)
    label = models.CharField("Название версии", max_length=120, blank=True)
    # Кто ещё правил документ между снимками — в истории показываются все.
    metadata = models.JSONField("Подробности", default=dict, blank=True)

    class Meta:
        db_table = "document_versions"
        verbose_name = "Версия документа"
        verbose_name_plural = "Версии документов"
        ordering = ("-version_number",)
        constraints = [
            models.UniqueConstraint(fields=("document", "version_number"),
                                     name="uniq_version_number_per_document"),
        ]
        indexes = [models.Index(fields=["document", "-created_at"])]

    def __str__(self):
        return f"Версия {self.version_number}"
