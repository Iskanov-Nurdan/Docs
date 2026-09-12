"""API шаблонов и готовых блоков."""
from django.db.models import Q
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.core.exceptions import AccessDeniedError, BusinessError, NotFoundError
from apps.core.permissions import IsAdmin
from apps.doc_templates.models import DocumentTemplate, TemplateCategory


class TemplateListSerializer(serializers.ModelSerializer):
    """Карточка в галерее: без содержимого, оно нужно только при создании."""

    category_display = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = DocumentTemplate
        fields = ("id", "title", "description", "category", "category_display",
                  "preview_image", "is_building_block", "is_personal")
        read_only_fields = fields


class TemplateDetailSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = DocumentTemplate
        fields = ("id", "title", "description", "category", "category_display", "content",
                  "preview_image", "is_building_block", "is_personal", "is_active", "order")
        read_only_fields = ("id",)


class TemplateViewSet(viewsets.ModelViewSet):
    """Читать может любой вошедший, менять — администратор."""

    serializer_class = TemplateDetailSerializer

    def get_queryset(self):
        user = self.request.user
        queryset = DocumentTemplate.objects.all()

        # Личные заготовки видит только их автор — и администратор их тоже
        # не видит: это рабочие черновики людей, а не общая галерея.
        if user.is_authenticated:
            queryset = queryset.filter(Q(is_personal=False) | Q(created_by=user))
        else:
            queryset = queryset.filter(is_personal=False)

        if not (user.is_authenticated and user.is_staff):
            queryset = queryset.filter(is_active=True)

        category = self.request.query_params.get("category")
        if category:
            queryset = queryset.filter(category=category)

        blocks = self.request.query_params.get("blocks")
        if blocks in {"true", "false"}:
            queryset = queryset.filter(is_building_block=blocks == "true")
        return queryset

    def get_serializer_class(self):
        return TemplateListSerializer if self.action == "list" else TemplateDetailSerializer

    def get_permissions(self):
        # Свой шаблон человек заводит и убирает сам: эти действия проверяют
        # авторство отдельно, ниже.
        if self.action in ("create", "update", "partial_update"):
            return [IsAdmin()]
        return super().get_permissions()

    def destroy(self, request, *args, **kwargs):
        template = self.get_object()
        own = template.is_personal and template.created_by_id == request.user.id
        if not own and not request.user.is_staff:
            raise AccessDeniedError("Удалять можно только свои шаблоны.")
        template.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["post"], url_path="from-document")
    def from_document(self, request):
        """Заготовка из своей таблицы: колонки, шапка и формулы — как есть.

        Содержимое берётся из базы, а не из открытой вкладки: в базе лежит
        последний сохранённый снимок книги, и он же уходит в поиск и выгрузку.
        """
        from apps.documents.repositories import DocumentRepository
        from apps.permissions.models import Role
        from apps.permissions.services import AccessService

        document_id = request.data.get("document_id")
        if not document_id:
            raise BusinessError("Не указана таблица.", code="no_document")

        document = DocumentRepository().by_id(document_id)
        if document is None:
            raise NotFoundError("Таблица не найдена.")

        # Хватает права смотреть: шаблон — это копия, а копирование владелец
        # может запретить отдельно.
        role = AccessService().require(user=request.user, document=document, minimum=Role.VIEWER)
        if not AccessService().can_copy(user=request.user, document=document, role=role):
            raise BusinessError("Владелец запретил копирование этой таблицы.", code="copy_denied")

        content = document.content
        if not isinstance(content, dict) or content.get("kind") != "sheet":
            raise BusinessError("Из этой таблицы шаблон не сделать.", code="unsupported_content")

        title = (request.data.get("title") or document.title or "Мой шаблон").strip()[:150]
        template = DocumentTemplate.objects.create(
            title=title,
            description=(request.data.get("description") or "").strip()[:300],
            category=TemplateCategory.BUSINESS,
            content=content,
            is_personal=True,
            is_active=True,
            created_by=request.user,
        )
        return Response(TemplateDetailSerializer(template).data, status=status.HTTP_201_CREATED)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return Response(serializer.data)
