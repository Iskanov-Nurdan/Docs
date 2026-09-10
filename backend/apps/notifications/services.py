"""Создание уведомлений.

Уведомление всегда создаётся в базе, а письмо уходит только если человек его
не отключил: список внутри приложения должен быть полным независимо от
настроек почты.
"""
import logging

from apps.notifications.models import Notification

logger = logging.getLogger(__name__)


class NotificationService:
    def create(self, *, user, type: str, actor=None, document=None, comment=None,
               message: str = "", send_email: bool = True) -> Notification | None:
        # Себе уведомления не приходят: человек и так знает, что сделал.
        if actor is not None and actor.id == user.id:
            return None

        notification = Notification.objects.create(
            user=user,
            actor=actor,
            type=type,
            document=document,
            comment=comment,
            message=message[:500],
        )

        if send_email and user.email_notifications:
            from apps.notifications.tasks import send_notification_email

            send_notification_email.delay(str(notification.id))
        return notification

    def document_shared(self, *, document, actor, recipient, role) -> Notification | None:
        return self.create(
            user=recipient,
            actor=actor,
            type=Notification.Type.DOCUMENT_SHARED,
            document=document,
            message=f"{actor.display_name} открыл доступ к документу «{document.title}»",
        )

    def comment_added(self, *, document, actor, comment, recipients) -> None:
        for recipient in recipients:
            self.create(
                user=recipient,
                actor=actor,
                type=Notification.Type.COMMENT_ADDED,
                document=document,
                comment=comment,
                message=f"{actor.display_name} оставил комментарий в «{document.title}»",
            )

    def comment_replied(self, *, document, actor, comment, recipient) -> Notification | None:
        return self.create(
            user=recipient,
            actor=actor,
            type=Notification.Type.COMMENT_REPLY,
            document=document,
            comment=comment,
            message=f"{actor.display_name} ответил на ваш комментарий",
        )

    def task_assigned(self, *, document, actor, comment, assignee) -> Notification | None:
        return self.create(
            user=assignee,
            actor=actor,
            type=Notification.Type.TASK_ASSIGNED,
            document=document,
            comment=comment,
            message=f"{actor.display_name} назначил вам задачу в «{document.title}»",
        )

    def mentioned(self, *, document, actor, comment, user) -> Notification | None:
        return self.create(
            user=user,
            actor=actor,
            type=Notification.Type.MENTIONED,
            document=document,
            comment=comment,
            message=f"{actor.display_name} упомянул вас в «{document.title}»",
        )

    def suggestion_added(self, *, document, actor, recipient) -> Notification | None:
        return self.create(
            user=recipient,
            actor=actor,
            type=Notification.Type.SUGGESTION_ADDED,
            document=document,
            message=f"{actor.display_name} предложил правку в «{document.title}»",
        )
