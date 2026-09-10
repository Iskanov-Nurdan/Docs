"""Права доступа к документу и ссылки для внешних читателей."""
import secrets

from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class Role(models.TextChoices):
    OWNER = "owner", "Владелец"
    EDITOR = "editor", "Редактор"
    COMMENTER = "commenter", "Комментатор"
    VIEWER = "viewer", "Читатель"


# Старшинство ролей: право сравнивается числом, а не перечислением условий.
ROLE_RANK = {Role.VIEWER: 1, Role.COMMENTER: 2, Role.EDITOR: 3, Role.OWNER: 4}


class DocumentPermission(TimeStampedModel):
    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, related_name="permissions")
    user = models.ForeignKey("users.User", verbose_name="Пользователь", on_delete=models.CASCADE,
                             related_name="document_permissions")
    role = models.CharField("Роль", max_length=10, choices=Role.choices, default=Role.VIEWER)
    granted_by = models.ForeignKey("users.User", verbose_name="Кто выдал",
                                   on_delete=models.SET_NULL, null=True, blank=True,
                                   related_name="granted_permissions")

    class Meta:
        db_table = "document_permissions"
        verbose_name = "Доступ к документу"
        verbose_name_plural = "Доступы к документам"
        constraints = [
            models.UniqueConstraint(fields=("document", "user"), name="uniq_permission_per_user"),
        ]
        indexes = [models.Index(fields=["user", "document"])]

    def __str__(self):
        return f"{self.user} — {self.get_role_display()}"


class LinkAccess(models.TextChoices):
    RESTRICTED = "restricted", "Только приглашённые"
    ANYONE = "anyone", "Все, у кого есть ссылка"


class DocumentShareLink(UUIDModel, TimeStampedModel):
    """Доступ по ссылке. Токен длинный: ссылка — это и есть пароль."""

    document = models.ForeignKey("documents.Document", verbose_name="Документ",
                                 on_delete=models.CASCADE, related_name="share_links")
    token = models.CharField("Токен", max_length=64, unique=True, db_index=True)
    role = models.CharField("Роль", max_length=10, choices=Role.choices, default=Role.VIEWER)
    access = models.CharField("Кому доступно", max_length=12, choices=LinkAccess.choices,
                              default=LinkAccess.RESTRICTED)
    expires_at = models.DateTimeField("Действует до", null=True, blank=True)
    is_active = models.BooleanField("Активна", default=True)
    created_by = models.ForeignKey("users.User", verbose_name="Создал", on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name="created_share_links")

    class Meta:
        db_table = "document_share_links"
        verbose_name = "Ссылка доступа"
        verbose_name_plural = "Ссылки доступа"

    @staticmethod
    def new_token() -> str:
        return secrets.token_urlsafe(32)
