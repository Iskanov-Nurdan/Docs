"""Комментарии, задачи и предложения правок."""
import logging
import re

from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from django.db import transaction
from django.utils import timezone

from apps.core.exceptions import AccessDeniedError, BusinessError
from apps.core.services import plain_text
from apps.comments.models import Comment, CommentReaction, Suggestion
from apps.notifications.services import NotificationService
from apps.permissions.models import ROLE_RANK, Role
from apps.permissions.services import AccessService

logger = logging.getLogger(__name__)

MENTION_PATTERN = re.compile(r"@([\w.+-]+@[\w-]+\.[\w.-]+)")


def broadcast(document_id, payload: dict) -> None:
    """Событие в открытые вкладки документа.

    Комментарии приходят по REST, но видеть их должны все, у кого документ
    открыт, — иначе обсуждение появляется только после перезагрузки.
    """
    layer = get_channel_layer()
    if layer is None:
        return
    async_to_sync(layer.group_send)(
        f"document.{document_id}", {"type": "comment.event", "data": payload}
    )


class CommentService:
    def __init__(self):
        self.access = AccessService()
        self.notifications = NotificationService()

    @transaction.atomic
    def create(self, *, user, document, content: str, selection_data: dict | None = None,
               quoted_text: str = "", parent_id=None, assignee_email: str = "") -> Comment:
        # Комментатору хватает роли «комментатор»: право писать в текст здесь
        # не требуется, и это отдельная роль в самом Google Docs.
        self.access.require(user=user, document=document, minimum=Role.COMMENTER)

        text = plain_text(content)
        if not text:
            raise BusinessError("Комментарий не может быть пустым.", code="empty_comment")

        parent = None
        if parent_id:
            parent = Comment.objects.filter(id=parent_id, document=document).first()
            if parent is None:
                raise BusinessError("Комментарий, на который вы отвечаете, не найден.",
                                     code="parent_not_found")
            # Ветка одноуровневая: ответ на ответ прикрепляется к корню.
            parent = parent if parent.parent_id is None else parent.parent

        assignee = self._resolve_assignee(assignee_email) if assignee_email else None

        comment = Comment.objects.create(
            document=document,
            user=user,
            parent=parent,
            content=text,
            selection_data=selection_data or {},
            quoted_text=quoted_text[:2000],
            assignee=assignee,
        )

        self._notify(document=document, comment=comment, actor=user, parent=parent,
                     assignee=assignee, text=text)
        broadcast(document.id, {"type": "comment_created", "comment_id": str(comment.id)})
        return comment

    def _resolve_assignee(self, email: str):
        from apps.users.repositories import UserRepository

        user = UserRepository().by_email(email)
        if user is None:
            raise BusinessError("Пользователь для задачи не найден.", code="assignee_not_found")
        return user

    def _notify(self, *, document, comment, actor, parent, assignee, text: str) -> None:
        if assignee is not None:
            self.notifications.task_assigned(document=document, actor=actor, comment=comment,
                                             assignee=assignee)

        # Упоминания разбираем по адресам в тексте.
        from apps.users.repositories import UserRepository

        repository = UserRepository()
        for email in set(MENTION_PATTERN.findall(text)):
            mentioned = repository.by_email(email)
            if mentioned and (assignee is None or mentioned.id != assignee.id):
                self.notifications.mentioned(document=document, actor=actor, comment=comment,
                                             user=mentioned)

        if parent is not None and parent.user_id:
            self.notifications.comment_replied(document=document, actor=actor, comment=comment,
                                               recipient=parent.user)
        else:
            recipients = [document.owner]
            self.notifications.comment_added(document=document, actor=actor, comment=comment,
                                             recipients=recipients)

    @transaction.atomic
    def update(self, *, user, comment: Comment, content: str) -> Comment:
        if comment.user_id != user.id:
            raise AccessDeniedError("Изменять комментарий может только его автор.")
        text = plain_text(content)
        if not text:
            raise BusinessError("Комментарий не может быть пустым.", code="empty_comment")
        comment.content = text
        comment.save(update_fields=["content", "updated_at"])
        broadcast(comment.document_id, {"type": "comment_updated", "comment_id": str(comment.id)})
        return comment

    @transaction.atomic
    def delete(self, *, user, comment: Comment) -> None:
        role = self.access.role_for(user=user, document=comment.document)
        # Удалить может автор или владелец документа: обсуждение в своём
        # документе должно оставаться управляемым.
        if comment.user_id != user.id and role != Role.OWNER:
            raise AccessDeniedError("Удалить комментарий может автор или владелец документа.")
        document_id = comment.document_id
        comment.delete()
        broadcast(document_id, {"type": "comment_deleted"})

    @transaction.atomic
    def set_resolved(self, *, user, comment: Comment, resolved: bool) -> Comment:
        self.access.require(user=user, document=comment.document, minimum=Role.COMMENTER)
        if comment.parent_id is not None:
            raise BusinessError("Закрывается вся ветка, а не отдельный ответ.",
                                 code="reply_not_resolvable")

        comment.is_resolved = resolved
        comment.resolved_by = user if resolved else None
        comment.resolved_at = timezone.now() if resolved else None
        comment.save(update_fields=["is_resolved", "resolved_by", "resolved_at", "updated_at"])
        broadcast(comment.document_id, {
            "type": "comment_resolved" if resolved else "comment_reopened",
            "comment_id": str(comment.id),
        })
        return comment

    @transaction.atomic
    def set_completed(self, *, user, comment: Comment, completed: bool) -> Comment:
        if comment.assignee_id is None:
            raise BusinessError("В этом комментарии нет задачи.", code="no_task")
        if comment.assignee_id != user.id and comment.document.owner_id != user.id:
            raise AccessDeniedError("Отметить задачу может исполнитель или владелец документа.")
        comment.is_completed = completed
        comment.save(update_fields=["is_completed", "updated_at"])
        return comment

    @transaction.atomic
    def toggle_reaction(self, *, user, comment: Comment, emoji: str) -> bool:
        self.access.require(user=user, document=comment.document, minimum=Role.COMMENTER)
        existing = CommentReaction.objects.filter(comment=comment, user=user, emoji=emoji).first()
        if existing:
            existing.delete()
            return False
        CommentReaction.objects.create(comment=comment, user=user, emoji=emoji)
        return True


class SuggestionService:
    def __init__(self):
        self.access = AccessService()
        self.notifications = NotificationService()

    @transaction.atomic
    def create(self, *, user, document, data: dict) -> Suggestion:
        self.access.require(user=user, document=document, minimum=Role.COMMENTER)
        suggestion = Suggestion.objects.create(document=document, user=user, **data)
        self.notifications.suggestion_added(document=document, actor=user,
                                            recipient=document.owner)
        broadcast(document.id, {"type": "suggestion_created", "suggestion_id": str(suggestion.id)})
        return suggestion

    @transaction.atomic
    def resolve(self, *, user, suggestion: Suggestion, accept: bool) -> Suggestion:
        role = self.access.require(user=user, document=suggestion.document, minimum=Role.EDITOR)
        if ROLE_RANK[role] < ROLE_RANK[Role.EDITOR]:
            raise AccessDeniedError("Решение по правке принимает редактор или владелец.")
        if suggestion.status != Suggestion.Status.PENDING:
            raise BusinessError("Предложение уже рассмотрено.", code="already_resolved")

        suggestion.status = (
            Suggestion.Status.ACCEPTED if accept else Suggestion.Status.REJECTED
        )
        suggestion.resolved_by = user
        suggestion.resolved_at = timezone.now()
        suggestion.save(update_fields=["status", "resolved_by", "resolved_at", "updated_at"])

        # Текст меняет редактор на клиенте: применить правку к CRDT может
        # только тот, у кого документ открыт, — сервер не трогает содержимое.
        broadcast(suggestion.document_id, {
            "type": "suggestion_updated",
            "suggestion_id": str(suggestion.id),
            "status": suggestion.status,
        })
        return suggestion
