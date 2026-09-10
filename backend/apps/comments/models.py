"""Комментарии, ответы и предложения правок."""
from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class Comment(UUIDModel, TimeStampedModel):
    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, related_name="comments")
    user = models.ForeignKey("users.User", verbose_name="Автор", on_delete=models.SET_NULL,
                             null=True, related_name="comments")
    # Ответ ссылается на корневой комментарий: ветка всегда одноуровневая,
    # как в самом Google Docs.
    parent = models.ForeignKey("self", verbose_name="Ответ на", on_delete=models.CASCADE,
                               null=True, blank=True, related_name="replies")
    content = models.TextField("Текст", max_length=5000)
    # Привязка к тексту: отметка в документе и цитата на случай, если
    # прокомментированный фрагмент удалят.
    selection_data = models.JSONField("Выделение", default=dict, blank=True)
    quoted_text = models.TextField("Процитированный текст", blank=True)

    is_resolved = models.BooleanField("Закрыт", default=False, db_index=True)
    resolved_by = models.ForeignKey("users.User", verbose_name="Кто закрыл",
                                    on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="resolved_comments")
    resolved_at = models.DateTimeField("Когда закрыт", null=True, blank=True)

    # Задача из комментария: «@Иван проверь раздел».
    assignee = models.ForeignKey("users.User", verbose_name="Исполнитель",
                                 on_delete=models.SET_NULL, null=True, blank=True,
                                 related_name="assigned_comments")
    is_completed = models.BooleanField("Задача выполнена", default=False)

    class Meta:
        db_table = "comments"
        verbose_name = "Комментарий"
        verbose_name_plural = "Комментарии"
        ordering = ("created_at",)
        indexes = [
            models.Index(fields=["document", "is_resolved", "created_at"]),
            models.Index(fields=["assignee", "is_completed"]),
        ]

    def __str__(self):
        return self.content[:50]

    @property
    def is_thread_root(self) -> bool:
        return self.parent_id is None


class CommentReaction(TimeStampedModel):
    """Эмодзи-реакция. Один человек — одна реакция каждого вида."""

    comment = models.ForeignKey(Comment, verbose_name="Комментарий", on_delete=models.CASCADE,
                                related_name="reactions")
    user = models.ForeignKey("users.User", verbose_name="Пользователь", on_delete=models.CASCADE,
                             related_name="comment_reactions")
    emoji = models.CharField("Эмодзи", max_length=8)

    class Meta:
        db_table = "comment_reactions"
        verbose_name = "Реакция"
        verbose_name_plural = "Реакции"
        constraints = [
            models.UniqueConstraint(fields=("comment", "user", "emoji"),
                                     name="uniq_reaction_per_user"),
        ]


class Suggestion(UUIDModel, TimeStampedModel):
    """Предложенная правка: в текст она попадает только после принятия."""

    class Operation(models.TextChoices):
        INSERT = "insert", "Вставка"
        DELETE = "delete", "Удаление"
        REPLACE = "replace", "Замена"
        FORMAT = "format", "Форматирование"

    class Status(models.TextChoices):
        PENDING = "pending", "На рассмотрении"
        ACCEPTED = "accepted", "Принято"
        REJECTED = "rejected", "Отклонено"

    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, related_name="suggestions")
    user = models.ForeignKey("users.User", verbose_name="Автор", on_delete=models.SET_NULL,
                             null=True, related_name="suggestions")
    operation = models.CharField("Операция", max_length=10, choices=Operation.choices)
    position = models.JSONField("Позиция в документе", default=dict)
    content = models.JSONField("Содержимое правки", default=dict, blank=True)
    original_text = models.TextField("Исходный текст", blank=True)
    suggested_text = models.TextField("Предложенный текст", blank=True)

    status = models.CharField("Статус", max_length=10, choices=Status.choices,
                              default=Status.PENDING, db_index=True)
    resolved_by = models.ForeignKey("users.User", verbose_name="Кто решил",
                                    on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name="resolved_suggestions")
    resolved_at = models.DateTimeField("Когда решено", null=True, blank=True)

    class Meta:
        db_table = "suggestions"
        verbose_name = "Предложение правки"
        verbose_name_plural = "Предложения правок"
        ordering = ("created_at",)
        indexes = [models.Index(fields=["document", "status"])]
