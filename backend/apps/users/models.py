"""Пользователь системы: вход по email."""
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.db import models

from apps.core.models import TimeStampedModel


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("Email обязателен.")
        # Регистр домена значения не имеет: Ivan@Mail.ru и ivan@mail.ru —
        # один человек, иначе на один ящик заведут два аккаунта.
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra_fields)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_active", True)
        extra_fields.setdefault("email_confirmed", True)
        if not extra_fields["is_staff"] or not extra_fields["is_superuser"]:
            raise ValueError("Суперпользователь должен иметь is_staff и is_superuser.")
        return self.create_user(email, password, **extra_fields)


class Theme(models.TextChoices):
    LIGHT = "light", "Светлая"
    DARK = "dark", "Тёмная"
    SYSTEM = "system", "Как в системе"


class User(AbstractBaseUser, PermissionsMixin, TimeStampedModel):
    email = models.EmailField("Email", unique=True, db_index=True)
    first_name = models.CharField("Имя", max_length=60, blank=True)
    last_name = models.CharField("Фамилия", max_length=60, blank=True)
    avatar = models.ImageField("Фотография", upload_to="avatars/", null=True, blank=True)

    is_active = models.BooleanField("Активен", default=True, db_index=True)
    is_staff = models.BooleanField("Доступ в админку", default=False)
    email_confirmed = models.BooleanField("Email подтверждён", default=False)

    language = models.CharField("Язык интерфейса", max_length=5, default="ru")
    theme = models.CharField("Тема", max_length=10, choices=Theme.choices, default=Theme.SYSTEM)
    email_notifications = models.BooleanField("Письма о событиях", default=True)
    editor_settings = models.JSONField("Настройки редактора", default=dict, blank=True)

    # Цвет курсора при совместном редактировании: закрепляется за человеком,
    # чтобы в разных документах его узнавали по одному цвету.
    cursor_color = models.CharField("Цвет курсора", max_length=7, blank=True)

    objects = UserManager()

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []

    class Meta:
        db_table = "users"
        verbose_name = "Пользователь"
        verbose_name_plural = "Пользователи"
        ordering = ("email",)

    def __str__(self):
        return self.full_name or self.email

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}".strip()

    @property
    def display_name(self) -> str:
        """Как подписывать курсор и комментарии."""
        return self.full_name or self.email.split("@")[0]

    @property
    def initials(self) -> str:
        parts = [part for part in (self.first_name, self.last_name) if part]
        if parts:
            return "".join(part[0].upper() for part in parts[:2])
        return self.email[:1].upper()


class EmailConfirmation(TimeStampedModel):
    """Одноразовые коды: подтверждение почты и сброс пароля."""

    class Purpose(models.TextChoices):
        CONFIRM_EMAIL = "confirm_email", "Подтверждение email"
        RESET_PASSWORD = "reset_password", "Сброс пароля"

    user = models.ForeignKey(User, verbose_name="Пользователь", on_delete=models.CASCADE,
                             related_name="confirmations")
    purpose = models.CharField("Назначение", max_length=20, choices=Purpose.choices)
    # Хранится хеш: утечка таблицы не должна давать доступ к чужим ящикам.
    token_hash = models.CharField("Хеш кода", max_length=64, db_index=True)
    expires_at = models.DateTimeField("Действует до")
    used_at = models.DateTimeField("Использован", null=True, blank=True)

    class Meta:
        db_table = "user_confirmations"
        verbose_name = "Код подтверждения"
        verbose_name_plural = "Коды подтверждения"
        indexes = [models.Index(fields=["purpose", "expires_at"])]
