"""Бизнес-логика пользователей: регистрация, вход, восстановление пароля."""
import hashlib
import logging
import secrets
from datetime import timedelta

from django.contrib.auth import authenticate
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from apps.core.exceptions import AccessDeniedError, BusinessError
from apps.users.models import EmailConfirmation, User
from apps.users.repositories import ConfirmationRepository, UserRepository

logger = logging.getLogger(__name__)

CONFIRM_TTL = timedelta(days=3)
RESET_TTL = timedelta(hours=2)

# Палитра курсоров: различимые между собой и читаемые на белом листе.
CURSOR_COLORS = (
    "#2563eb", "#dc2626", "#16a34a", "#d97706", "#7c3aed",
    "#0891b2", "#db2777", "#65a30d", "#ea580c", "#4f46e5",
)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class UserService:
    def __init__(self):
        self.repository = UserRepository()
        self.confirmations = ConfirmationRepository()

    @transaction.atomic
    def issue_confirmation(self, user: User, purpose: str, ttl: timedelta) -> str:
        """Возвращает код одним разом: в базе остаётся только его хеш."""
        token = secrets.token_urlsafe(32)
        EmailConfirmation.objects.create(
            user=user,
            purpose=purpose,
            token_hash=hash_token(token),
            expires_at=timezone.now() + ttl,
        )
        return token

    def login(self, *, email: str, password: str) -> dict:
        user = authenticate(username=email.strip().lower(), password=password)
        if user is None:
            # Одинаковый ответ на неизвестный email и неверный пароль:
            # иначе форма входа превращается в проверку, кто зарегистрирован.
            raise AccessDeniedError("Неверный email или пароль.")
        if not user.is_active:
            raise AccessDeniedError("Учётная запись заблокирована.")

        logger.info("Вход пользователя %s", user.email)
        return self.issue_tokens(user)

    def issue_tokens(self, user: User) -> dict:
        refresh = RefreshToken.for_user(user)
        return {"access": str(refresh.access_token), "refresh": str(refresh)}

    def confirm_email(self, token: str) -> User:
        record = self.confirmations.active(hash_token(token), EmailConfirmation.Purpose.CONFIRM_EMAIL)
        if record is None:
            raise BusinessError("Ссылка недействительна или устарела.", code="invalid_token")

        with transaction.atomic():
            record.used_at = timezone.now()
            record.save(update_fields=["used_at", "updated_at"])
            record.user.email_confirmed = True
            record.user.save(update_fields=["email_confirmed", "updated_at"])
        logger.info("Подтверждён email %s", record.user.email)
        return record.user

    def request_password_reset(self, email: str) -> None:
        user = self.repository.by_email(email)
        if user is None or not user.is_active:
            # Молча выходим: ответ не должен отличаться для существующего
            # и несуществующего адреса.
            logger.info("Запрос сброса пароля для неизвестного адреса")
            return

        token = self.issue_confirmation(user, EmailConfirmation.Purpose.RESET_PASSWORD, RESET_TTL)

        from apps.notifications.tasks import send_password_reset

        send_password_reset.delay(str(user.id), token)

    @transaction.atomic
    def reset_password(self, *, token: str, new_password: str) -> User:
        record = self.confirmations.active(hash_token(token), EmailConfirmation.Purpose.RESET_PASSWORD)
        if record is None:
            raise BusinessError("Ссылка недействительна или устарела.", code="invalid_token")

        user = record.user
        user.set_password(new_password)
        user.save(update_fields=["password", "updated_at"])
        record.used_at = timezone.now()
        record.save(update_fields=["used_at", "updated_at"])
        logger.info("Сброшен пароль пользователя %s", user.email)
        return user

    @transaction.atomic
    def change_password(self, *, user: User, current_password: str, new_password: str) -> User:
        if not user.check_password(current_password):
            raise AccessDeniedError("Текущий пароль указан неверно.")
        user.set_password(new_password)
        user.save(update_fields=["password", "updated_at"])
        logger.info("Пользователь %s сменил пароль", user.email)
        return user

    @transaction.atomic
    def update_profile(self, *, user: User, data: dict) -> User:
        for field, value in data.items():
            setattr(user, field, value)
        user.save()
        return user
