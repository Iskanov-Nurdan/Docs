"""Схемы данных документов и папок."""
from rest_framework import serializers

from apps.core.services import plain_text
from apps.documents.models import Document, DocumentMode, Folder, Orientation, PageSize
from apps.users.serializers import UserShortSerializer


class FolderSerializer(serializers.ModelSerializer):
    documents_count = serializers.IntegerField(read_only=True, default=0)

    class Meta:
        model = Folder
        fields = ("id", "name", "parent", "documents_count", "created_at", "updated_at")
        read_only_fields = ("id", "created_at", "updated_at")


class FolderWriteSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    parent_id = serializers.UUIDField(required=False, allow_null=True)

    def validate_name(self, value: str) -> str:
        name = plain_text(value)
        if not name:
            raise serializers.ValidationError("Укажите название папки.")
        return name


class DocumentListSerializer(serializers.ModelSerializer):
    """Карточка в списке: без содержимого, оно там не нужно."""

    owner = UserShortSerializer(read_only=True)
    last_edited_by = UserShortSerializer(read_only=True)
    preview = serializers.CharField(read_only=True)
    is_starred = serializers.BooleanField(read_only=True, default=False)
    my_role = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = (
            "id", "title", "owner", "folder", "preview", "is_starred", "is_published",
            "last_edited_by", "last_edited_at", "created_at", "updated_at", "deleted_at",
            "my_role",
        )
        read_only_fields = fields

    def get_my_role(self, document: Document) -> str | None:
        return (self.context.get("roles") or {}).get(document.id)


class DocumentDetailSerializer(serializers.ModelSerializer):
    owner = UserShortSerializer(read_only=True)
    last_edited_by = UserShortSerializer(read_only=True)
    my_role = serializers.SerializerMethodField()
    headings = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = (
            "id", "title", "owner", "folder", "content",
            "document_mode", "page_size", "orientation",
            "margin_top", "margin_bottom", "margin_left", "margin_right", "page_color",
            "is_published", "allow_download", "allow_copy", "allow_print",
            "last_edited_by", "last_edited_at", "created_at", "updated_at", "deleted_at",
            "my_role", "headings", "stats",
        )
        read_only_fields = fields

    def get_my_role(self, document: Document) -> str | None:
        return self.context.get("role")

    def get_headings(self, document: Document) -> list:
        from apps.documents.text import extract_headings

        return extract_headings(document.content)

    def get_stats(self, document: Document) -> dict:
        from apps.documents.text import count_stats

        return count_stats(document.content)


class DocumentCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, default="Без названия")
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    template_id = serializers.UUIDField(required=False, allow_null=True)


class DocumentUpdateSerializer(serializers.Serializer):
    """Свойства документа. Текст приходит отдельным полем content."""

    title = serializers.CharField(max_length=255, required=False)
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    content = serializers.JSONField(required=False)
    document_mode = serializers.ChoiceField(choices=DocumentMode.choices, required=False)
    page_size = serializers.ChoiceField(choices=PageSize.choices, required=False)
    orientation = serializers.ChoiceField(choices=Orientation.choices, required=False)
    margin_top = serializers.FloatField(required=False, min_value=0, max_value=100)
    margin_bottom = serializers.FloatField(required=False, min_value=0, max_value=100)
    margin_left = serializers.FloatField(required=False, min_value=0, max_value=100)
    margin_right = serializers.FloatField(required=False, min_value=0, max_value=100)
    page_color = serializers.RegexField(r"^#[0-9a-fA-F]{6}$", required=False)
    allow_download = serializers.BooleanField(required=False)
    allow_copy = serializers.BooleanField(required=False)
    allow_print = serializers.BooleanField(required=False)

    def validate_title(self, value: str) -> str:
        return plain_text(value)

    def validate_content(self, value):
        if not isinstance(value, dict) or value.get("type") != "doc":
            raise serializers.ValidationError("Содержимое должно быть документом ProseMirror.")
        return value

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Не переданы поля для изменения.")
        return attrs
