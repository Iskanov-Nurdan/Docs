"""Отправка писем в фоне: HTTP-ответ не должен ждать почтовый сервер."""
import logging

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)

FRONTEND_URL = getattr(settings, "FRONTEND_URL", "http://localhost:5173")


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_email_confirmation(self, user_id: str, token: str):
    from apps.users.models import User

    user = User.objects.filter(id=user_id).first()
    if user is None:
        return

    link = f"{FRONTEND_URL}/confirm-email?token={token}"
    try:
        send_mail(
            subject="Подтверждение адреса",
            message=(
                f"Здравствуйте!\n\n"
                f"Подтвердите адрес, перейдя по ссылке:\n{link}\n\n"
                f"Ссылка действует трое суток. Если вы не регистрировались, "
                f"просто не отвечайте на это письмо."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
    except Exception as exc:  # noqa: BLE001 — почта падает по внешним причинам
        logger.warning("Не удалось отправить подтверждение на %s: %s", user.email, exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_password_reset(self, user_id: str, token: str):
    from apps.users.models import User

    user = User.objects.filter(id=user_id).first()
    if user is None:
        return

    link = f"{FRONTEND_URL}/reset-password?token={token}"
    try:
        send_mail(
            subject="Восстановление пароля",
            message=(
                f"Здравствуйте!\n\n"
                f"Задать новый пароль можно по ссылке:\n{link}\n\n"
                f"Ссылка действует два часа. Если вы не запрашивали смену пароля, "
                f"ничего делать не нужно — пароль останется прежним."
            ),
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[user.email],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Не удалось отправить письмо сброса на %s: %s", user.email, exc)
        raise self.retry(exc=exc)


@shared_task(bind=True, max_retries=3, default_retry_delay=120)
def send_notification_email(self, notification_id: str):
    from apps.notifications.models import Notification

    notification = (
        Notification.objects.filter(id=notification_id)
        .select_related("user", "document")
        .first()
    )
    if notification is None or not notification.user.email_notifications:
        return

    document = notification.document
    link = f"{FRONTEND_URL}/docs/{document.id}" if document else FRONTEND_URL
    try:
        send_mail(
            subject=notification.message or "Новое событие",
            # В письмо не попадает содержимое документа — только факт события
            # и ссылка: почтовый ящик получателя нам не подконтролен.
            message=f"{notification.message}\n\nОткрыть: {link}",
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[notification.user.email],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Не удалось отправить уведомление %s: %s", notification_id, exc)
        raise self.retry(exc=exc)
