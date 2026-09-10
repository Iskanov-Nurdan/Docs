"""Доступ к данным пользователей."""
from django.db.models import QuerySet

from apps.users.models import EmailConfirmation, User


class UserRepository:
    def get_queryset(self) -> QuerySet[User]:
        return User.objects.all()

    def by_email(self, email: str) -> User | None:
        return self.get_queryset().filter(email=email.strip().lower()).first()

    def email_exists(self, email: str) -> bool:
        return self.get_queryset().filter(email=email.strip().lower()).exists()

    def search(self, query: str, limit: int = 10) -> QuerySet[User]:
        """Подсказка адресатов при выдаче доступа и упоминаниях."""
        query = (query or "").strip()
        if len(query) < 2:
            return User.objects.none()
        return (
            self.get_queryset()
            .filter(is_active=True)
            .filter(email__icontains=query)
            .order_by("email")[:limit]
        )


class ConfirmationRepository:
    def active(self, token_hash: str, purpose: str) -> EmailConfirmation | None:
        from django.utils import timezone

        return (
            EmailConfirmation.objects.filter(
                token_hash=token_hash,
                purpose=purpose,
                used_at__isnull=True,
                expires_at__gt=timezone.now(),
            )
            .select_related("user")
            .first()
        )
