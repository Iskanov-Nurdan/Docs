"""API шаблонов и готовых блоков."""
from rest_framework import serializers, viewsets
from rest_framework.response import Response

from apps.core.permissions import IsAdmin
from apps.doc_templates.models import DocumentTemplate


class TemplateListSerializer(serializers.ModelSerializer):
    """Карточка в галерее: без содержимого, оно нужно только при создании."""

    category_display = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = DocumentTemplate
        fields = ("id", "title", "description", "category", "category_display",
                  "preview_image", "is_building_block")
        read_only_fields = fields


class TemplateDetailSerializer(serializers.ModelSerializer):
    category_display = serializers.CharField(source="get_category_display", read_only=True)

    class Meta:
        model = DocumentTemplate
        fields = ("id", "title", "description", "category", "category_display", "content",
                  "preview_image", "is_building_block", "is_active", "order")
        read_only_fields = ("id",)


class TemplateViewSet(viewsets.ModelViewSet):
    """Читать может любой вошедший, менять — администратор."""

    serializer_class = TemplateDetailSerializer

    def get_queryset(self):
        queryset = DocumentTemplate.objects.all()
        if not (self.request.user.is_authenticated and self.request.user.is_staff):
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
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAdmin()]
        return super().get_permissions()

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    def list(self, request, *args, **kwargs):
        serializer = self.get_serializer(self.get_queryset(), many=True)
        return Response(serializer.data)
