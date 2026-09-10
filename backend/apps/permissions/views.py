"""Управление доступом к документу."""
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import BusinessError, NotFoundError
from apps.core.services import client_ip
from apps.documents.models import DocumentActivity
from apps.documents.repositories import DocumentRepository
from apps.documents.services import DocumentService
from apps.permissions.models import DocumentPermission, LinkAccess, Role
from apps.permissions.serializers import (
    PermissionGrantSerializer,
    PermissionSerializer,
    ShareLinkSerializer,
    ShareLinkUpdateSerializer,
)
from apps.permissions.services import AccessService
from apps.users.repositories import UserRepository


class DocumentPermissionsView(APIView):
    """GET — кто имеет доступ, POST — выдать доступ."""

    def _document(self, document_id):
        document = DocumentRepository().by_id(document_id)
        if document is None:
            raise NotFoundError("Документ не найден.")
        return document

    def get(self, request, document_id):
        document = self._document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER)

        permissions = document.permissions.select_related("user").all()
        link = document.share_links.first()
        return Response({
            "owner": PermissionSerializer.owner_payload(document.owner),
            "permissions": PermissionSerializer(permissions, many=True).data,
            "link": ShareLinkSerializer(link).data if link else None,
        })

    def post(self, request, document_id):
        document = self._document(document_id)
        serializer = PermissionGrantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        target = UserRepository().by_email(data["email"])
        if target is None:
            # Приглашать незарегистрированных пока нельзя: доступ выдаётся
            # существующей учётной записи, иначе документ некому показать.
            raise BusinessError(
                "Пользователь с таким адресом не зарегистрирован.", code="user_not_found"
            )

        permission = AccessService().grant(
            actor=request.user, document=document, target_user=target, role=data["role"]
        )
        DocumentService().log(document=document, user=request.user,
                              action=DocumentActivity.Action.SHARED, ip=client_ip(request),
                              metadata={"email": target.email, "role": data["role"]})
        return Response(PermissionSerializer(permission).data, status=status.HTTP_201_CREATED)


class DocumentPermissionDetailView(APIView):
    """Изменение и отзыв конкретного доступа."""

    def _permission(self, document_id, permission_id) -> DocumentPermission:
        permission = (
            DocumentPermission.objects.select_related("document", "user")
            .filter(id=permission_id, document_id=document_id)
            .first()
        )
        if permission is None:
            raise NotFoundError("Доступ не найден.")
        return permission

    def patch(self, request, document_id, permission_id):
        permission = self._permission(document_id, permission_id)
        serializer = PermissionGrantSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        role = serializer.validated_data.get("role")
        if not role:
            raise BusinessError("Укажите роль.")

        updated = AccessService().grant(
            actor=request.user,
            document=permission.document,
            target_user=permission.user,
            role=role,
        )
        return Response(PermissionSerializer(updated).data)

    def delete(self, request, document_id, permission_id):
        permission = self._permission(document_id, permission_id)
        AccessService().revoke(actor=request.user, document=permission.document,
                               permission=permission)
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentShareLinkView(APIView):
    """Доступ по ссылке."""

    def put(self, request, document_id):
        document = DocumentRepository().by_id(document_id)
        if document is None:
            raise NotFoundError("Документ не найден.")

        serializer = ShareLinkUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        link = AccessService().set_link_access(
            actor=request.user,
            document=document,
            access=data["access"],
            role=data.get("role", Role.VIEWER),
            expires_at=data.get("expires_at"),
        )
        DocumentService().log(document=document, user=request.user,
                              action=DocumentActivity.Action.SHARED, ip=client_ip(request),
                              metadata={"link_access": data["access"]})
        return Response(ShareLinkSerializer(link).data)


class ResolveShareLinkView(APIView):
    """Открытие документа по ссылке — единственная точка входа без приглашения."""

    permission_classes = (AllowAny,)

    def get(self, request, token):
        from apps.documents.serializers import DocumentDetailSerializer
        from apps.permissions.models import DocumentShareLink

        link = (
            DocumentShareLink.objects.select_related("document")
            .filter(token=token, is_active=True, access=LinkAccess.ANYONE)
            .first()
        )
        if link is None or link.document.deleted_at is not None:
            raise NotFoundError("Ссылка недействительна.")

        from django.utils import timezone

        if link.expires_at and link.expires_at <= timezone.now():
            raise NotFoundError("Срок действия ссылки истёк.")

        document = link.document
        return Response(
            DocumentDetailSerializer(document, context={"role": link.role}).data
        )
