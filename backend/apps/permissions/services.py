"""Проверка прав на документ — единственное место, где решается доступ.

Любой путь к документу (REST, WebSocket, экспорт, публикация) обязан пройти
через `AccessService.require`. Разрозненные проверки в представлениях — как раз
то, из-за чего в подобных системах документы утекают: одну ветку забыли,
и `GET /api/documents/{id}` отдаёт чужой файл.
"""
import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.core.exceptions import AccessDeniedError, BusinessError, NotFoundError
from apps.documents.models import Document
from apps.permissions.models import ROLE_RANK, DocumentPermission, DocumentShareLink, LinkAccess, Role

logger = logging.getLogger(__name__)


class AccessService:
    """Кто и что может делать с документом."""

    def role_for(self, *, user, document: Document, link_token: str | None = None) -> Role | None:
        """Наивысшая роль пользователя для документа или None, если доступа нет."""
        if document.owner_id and user and user.is_authenticated and document.owner_id == user.id:
            return Role.OWNER

        roles: list[Role] = []

        if user and user.is_authenticated:
            permission = document.permissions.filter(user=user).first()
            if permission:
                roles.append(Role(permission.role))

        link_role = self._role_from_link(document, link_token)
        if link_role:
            roles.append(link_role)

        if not roles:
            return None
        return max(roles, key=lambda role: ROLE_RANK[role])

    def _role_from_link(self, document: Document, token: str | None) -> Role | None:
        if not token:
            return None
        link = document.share_links.filter(token=token, is_active=True).first()
        if link is None:
            return None
        if link.access != LinkAccess.ANYONE:
            return None
        if link.expires_at and link.expires_at <= timezone.now():
            return None
        return Role(link.role)

    def require(self, *, user, document: Document, minimum: Role,
                link_token: str | None = None) -> Role:
        """Возвращает роль или выбрасывает ошибку. Единственная точка отказа."""
        if document.deleted_at is not None and (
            not user or not user.is_authenticated or document.owner_id != user.id
        ):
            # Удалённый документ виден только владельцу — в его корзине.
            raise NotFoundError("Документ не найден.")

        role = self.role_for(user=user, document=document, link_token=link_token)
        if role is None:
            # Ответ 404, а не 403: иначе по коду ответа можно перебором
            # выяснить, какие документы существуют.
            raise NotFoundError("Документ не найден.")

        if ROLE_RANK[role] < ROLE_RANK[minimum]:
            raise AccessDeniedError(
                f"Требуется роль не ниже «{Role(minimum).label}», у вас «{Role(role).label}»."
            )
        return role

    def can_download(self, *, user, document: Document, role: Role) -> bool:
        """Владелец может закрыть скачивание для всех остальных."""
        return role == Role.OWNER or document.allow_download

    def can_copy(self, *, user, document: Document, role: Role) -> bool:
        return role == Role.OWNER or document.allow_copy

    def can_print(self, *, user, document: Document, role: Role) -> bool:
        return role == Role.OWNER or document.allow_print

    def accessible_documents(self, user):
        """Документы, которые пользователь вправе видеть в списке."""
        return Document.objects.filter(
            Q(owner=user) | Q(permissions__user=user)
        ).distinct()

    @transaction.atomic
    def grant(self, *, actor, document: Document, target_user, role: Role) -> DocumentPermission:
        self.require(user=actor, document=document, minimum=Role.OWNER)

        if target_user.id == document.owner_id:
            raise BusinessError("Владелец уже имеет полный доступ.", code="owner_already")
        if role == Role.OWNER:
            raise BusinessError("Передача владения выполняется отдельным действием.",
                                code="owner_transfer")

        permission, created = DocumentPermission.objects.update_or_create(
            document=document,
            user=target_user,
            defaults={"role": role, "granted_by": actor},
        )
        logger.info(
            "Доступ к документу %s: %s -> %s (выдал %s)",
            document.id, target_user.email, role, actor.email,
        )

        from apps.notifications.services import NotificationService

        if created:
            NotificationService().document_shared(
                document=document, actor=actor, recipient=target_user, role=role
            )
        return permission

    @transaction.atomic
    def revoke(self, *, actor, document: Document, permission: DocumentPermission) -> None:
        self.require(user=actor, document=document, minimum=Role.OWNER)
        logger.info("Доступ к документу %s отозван у %s", document.id, permission.user.email)
        permission.delete()

    @transaction.atomic
    def set_link_access(self, *, actor, document: Document, access: LinkAccess,
                        role: Role = Role.VIEWER, expires_at=None) -> DocumentShareLink:
        """Настройка доступа по ссылке. Токен создаётся один раз и переиспользуется."""
        self.require(user=actor, document=document, minimum=Role.OWNER)

        if role == Role.OWNER:
            raise BusinessError("По ссылке нельзя выдать права владельца.", code="owner_by_link")

        link = document.share_links.first()
        if link is None:
            link = DocumentShareLink(
                document=document,
                token=DocumentShareLink.new_token(),
                created_by=actor,
            )
        link.access = access
        link.role = role
        link.expires_at = expires_at
        link.is_active = True
        link.save()
        logger.info("Ссылка документа %s: доступ %s, роль %s", document.id, access, role)
        return link
