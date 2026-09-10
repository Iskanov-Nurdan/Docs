"""HTTP-слой документов: разбор запроса, проверка прав, вызов сервиса."""
import logging

from django.db.models import Count
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import BusinessError, NotFoundError
from apps.core.services import client_ip
from apps.documents.models import Document, DocumentActivity, Folder
from apps.documents.repositories import DocumentRepository, FolderRepository
from apps.documents.serializers import (
    DocumentCreateSerializer,
    DocumentDetailSerializer,
    DocumentListSerializer,
    DocumentUpdateSerializer,
    FolderSerializer,
    FolderWriteSerializer,
)
from apps.documents.services import DocumentService
from apps.permissions.models import Role
from apps.permissions.services import AccessService

logger = logging.getLogger(__name__)


class DocumentViewSet(viewsets.ViewSet):
    """Документы. Доступ к каждому проверяется через AccessService."""

    def _get_document(self, pk) -> Document:
        document = DocumentRepository().by_id(pk)
        if document is None:
            # Тот же ответ, что и при отсутствии прав: существование чужих
            # документов не должно определяться перебором адресов.
            raise NotFoundError("Документ не найден.")
        return document

    def _link_token(self, request) -> str | None:
        return request.query_params.get("link") or request.headers.get("X-Share-Link")

    def list(self, request):
        repository = DocumentRepository()
        scope = request.query_params.get("scope", "active")

        if scope == "trash":
            queryset = repository.trashed(request.user)
        elif scope == "starred":
            queryset = repository.starred(request.user)
        elif scope == "search":
            queryset = repository.search(request.user, request.query_params.get("q", ""))
        else:
            queryset = repository.active(request.user)

        folder_id = request.query_params.get("folder")
        if folder_id:
            queryset = queryset.filter(folder_id=folder_id)

        ordering = request.query_params.get("ordering", "-last_edited_at")
        allowed = {
            "title", "-title",
            "created_at", "-created_at",
            "last_edited_at", "-last_edited_at",
        }
        if ordering in allowed:
            queryset = queryset.order_by(ordering)

        from apps.core.pagination import DefaultPagination

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        serializer = DocumentListSerializer(page, many=True, context={"request": request})
        return paginator.get_paginated_response(serializer.data)

    def create(self, request):
        serializer = DocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        service = DocumentService()

        template_id = data.get("template_id")
        if template_id:
            from apps.doc_templates.models import DocumentTemplate

            template = DocumentTemplate.objects.filter(id=template_id, is_active=True).first()
            if template is None:
                raise BusinessError("Шаблон не найден.", code="template_not_found")
            document = service.create_from_template(user=request.user, template=template,
                                                     ip=client_ip(request))
        else:
            document = service.create(
                user=request.user,
                title=data.get("title", "Без названия"),
                folder_id=data.get("folder_id"),
                ip=client_ip(request),
            )

        return Response(
            DocumentDetailSerializer(document, context={"role": Role.OWNER}).data,
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        document = self._get_document(pk)
        role = AccessService().require(
            user=request.user, document=document, minimum=Role.VIEWER,
            link_token=self._link_token(request),
        )
        DocumentService().log(document=document, user=request.user,
                              action=DocumentActivity.Action.OPENED, ip=client_ip(request))
        return Response(DocumentDetailSerializer(document, context={"role": role}).data)

    def partial_update(self, request, pk=None):
        document = self._get_document(pk)
        serializer = DocumentUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        document = DocumentService().update(
            user=request.user, document=document, data=serializer.validated_data,
            ip=client_ip(request),
        )
        return Response(DocumentDetailSerializer(document, context={"role": Role.OWNER}).data)

    def destroy(self, request, pk=None):
        document = self._get_document(pk)
        permanent = request.query_params.get("permanent") == "true"
        service = DocumentService()
        if permanent:
            service.delete_permanently(user=request.user, document=document)
        else:
            service.delete(user=request.user, document=document, ip=client_ip(request))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        document = self._get_document(pk)
        document = DocumentService().restore(user=request.user, document=document,
                                             ip=client_ip(request))
        return Response(DocumentDetailSerializer(document, context={"role": Role.OWNER}).data)

    @action(detail=True, methods=["post"])
    def copy(self, request, pk=None):
        document = self._get_document(pk)
        copy = DocumentService().copy(user=request.user, document=document, ip=client_ip(request))
        return Response(
            DocumentDetailSerializer(copy, context={"role": Role.OWNER}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def star(self, request, pk=None):
        document = self._get_document(pk)
        is_starred = DocumentService().toggle_star(user=request.user, document=document)
        return Response({"is_starred": is_starred})

    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        document = self._get_document(pk)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER,
                                link_token=self._link_token(request))
        rows = document.activities.select_related("user")[:100]
        return Response([
            {
                "id": row.id,
                "action": row.action,
                "action_display": row.get_action_display(),
                "user": row.user.display_name if row.user else None,
                "created_at": row.created_at,
                "metadata": row.metadata,
            }
            for row in rows
        ])


class FolderViewSet(viewsets.ViewSet):
    """Папки пользователя."""

    def list(self, request):
        folders = (
            FolderRepository()
            .for_user(request.user)
            .annotate(documents_count=Count("documents"))
        )
        return Response(FolderSerializer(folders, many=True).data)

    def create(self, request):
        serializer = FolderWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        parent = None
        if data.get("parent_id"):
            parent = FolderRepository().by_id(data["parent_id"], request.user)
            if parent is None:
                raise BusinessError("Родительская папка не найдена.", code="parent_not_found")

        folder = Folder.objects.create(name=data["name"], owner=request.user, parent=parent)
        return Response(FolderSerializer(folder).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        folder = FolderRepository().by_id(pk, request.user)
        if folder is None:
            raise NotFoundError("Папка не найдена.")

        serializer = FolderWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "name" in data:
            folder.name = data["name"]
        if "parent_id" in data:
            parent = None
            if data["parent_id"]:
                parent = FolderRepository().by_id(data["parent_id"], request.user)
                if parent is None:
                    raise BusinessError("Родительская папка не найдена.", code="parent_not_found")
                # Папку нельзя вложить в собственную ветку: получилось бы
                # кольцо, и обход дерева зациклился бы.
                if parent.id == folder.id or parent in FolderRepository().descendants(folder):
                    raise BusinessError("Папку нельзя переместить внутрь самой себя.",
                                         code="folder_cycle")
            folder.parent = parent
        folder.save()
        return Response(FolderSerializer(folder).data)

    def destroy(self, request, pk=None):
        folder = FolderRepository().by_id(pk, request.user)
        if folder is None:
            raise NotFoundError("Папка не найдена.")
        # Документы не удаляются вместе с папкой: они переходят в корень,
        # иначе одно нажатие уносило бы в корзину десятки файлов.
        folder.documents.update(folder=None)
        folder.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentSearchView(APIView):
    """Глобальный поиск по названию и содержимому."""

    def get(self, request):
        query = request.query_params.get("q", "")
        documents = DocumentRepository().search(request.user, query)[:50]
        return Response(DocumentListSerializer(documents, many=True).data)
