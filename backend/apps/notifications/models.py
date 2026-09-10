"""Уведомления внутри приложения."""
from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class Notification(UUIDModel, TimeStampedModel):
    class Type(models.TextChoices):
        DOCUMENT_SHARED = "document_shared", "Открыт доступ к документу"
        COMMENT_ADDED = "comment_added", "Новый комментарий"
        COMMENT_REPLY = "comment_reply", "Ответ на комментарий"
        MENTIONED = "mentioned", "Упоминание"
        TASK_ASSIGNED = "task_assigned", "Назначена задача"
        SUGGESTION_ADDED = "suggestion_added", "Предложена правка"
        SUGGESTION_RESOLVED = "suggestion_resolved", "Предложение рассмотрено"

    user = models.ForeignKey("users.User", verbose_name="Получатель", on_delete=models.CASCADE,
                             related_name="notifications")
    actor = models.ForeignKey("users.User", verbose_name="Кто вызвал", on_delete=models.SET_NULL,
                              null=True, blank=True, related_name="caused_notifications")
    type = models.CharField("Тип", max_length=25, choices=Type.choices)
    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, null=True, blank=True,
                                 related_name="notifications")
    comment = models.ForeignKey("comments.Comment", verbose_name="Комментарий",
                                on_delete=models.CASCADE, null=True, blank=True,
                                related_name="notifications")
    message = models.CharField("Текст", max_length=500, blank=True)
    is_read = models.BooleanField("Прочитано", default=False, db_index=True)

    class Meta:
        db_table = "notifications"
        verbose_name = "Уведомление"
        verbose_name_plural = "Уведомления"
        ordering = ("-created_at",)
        indexes = [models.Index(fields=["user", "is_read", "-created_at"])]

    def __str__(self):
        return f"{self.get_type_display()} для {self.user_id}"
