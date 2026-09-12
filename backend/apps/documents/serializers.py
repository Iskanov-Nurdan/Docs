"""Схемы данных документов и папок."""
from rest_framework import serializers

from apps.core.services import plain_text
from apps.documents.models import Document, Folder
from apps.files.converters import MAX_CELLS, parse_address
from apps.users.serializers import UserShortSerializer

# Листов в книге. Ячейки ограничены отдельно — MAX_CELLS из converters,
# теми же границами, по которым строится выгрузка.
MAX_SHEETS = 50


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
    snippet = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = (
            "id", "title", "owner", "folder", "preview", "snippet", "is_starred",
            "is_published", "last_edited_by", "last_edited_at", "created_at", "updated_at",
            "deleted_at", "my_role",
        )
        read_only_fields = fields

    def get_my_role(self, document: Document) -> str | None:
        return (self.context.get("roles") or {}).get(document.id)

    def get_snippet(self, document: Document) -> str:
        """Кусок текста вокруг найденного — чтобы было видно, почему нашлось.

        Без него выдача по номеру бесполезна: в списке одни названия, и понять,
        в каком из них тот самый счёт, можно только открыв каждый по очереди.
        """
        query = (self.context.get("query") or "").strip()
        if not query:
            return ""

        text = document.plain_text or ""
        position = text.lower().find(query.lower())
        if position == -1:
            return ""

        start = max(0, position - 40)
        end = min(len(text), position + len(query) + 60)
        fragment = " ".join(text[start:end].split())
        return f"{'…' if start > 0 else ''}{fragment}{'…' if end < len(text) else ''}"


class DocumentDetailSerializer(serializers.ModelSerializer):
    owner = UserShortSerializer(read_only=True)
    last_edited_by = UserShortSerializer(read_only=True)
    my_role = serializers.SerializerMethodField()
    stats = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = (
            "id", "title", "owner", "folder", "content",
            "is_published", "allow_download", "allow_copy", "allow_print",
            "last_edited_by", "last_edited_at", "created_at", "updated_at", "deleted_at",
            "my_role", "stats",
        )
        read_only_fields = fields

    def get_my_role(self, document: Document) -> str | None:
        return self.context.get("role")

    def get_stats(self, document: Document) -> dict:
        from apps.documents.text import count_stats

        return count_stats(document.content)


class DocumentCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, default="Без названия")
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    template_id = serializers.UUIDField(required=False, allow_null=True)


class DocumentUpdateSerializer(serializers.Serializer):
    """Свойства документа. Содержимое приходит отдельным полем content."""

    title = serializers.CharField(max_length=255, required=False)
    folder_id = serializers.UUIDField(required=False, allow_null=True)
    content = serializers.JSONField(required=False)
    allow_download = serializers.BooleanField(required=False)
    allow_copy = serializers.BooleanField(required=False)
    allow_print = serializers.BooleanField(required=False)

    def validate_title(self, value: str) -> str:
        return plain_text(value)

    def validate_content(self, value):
        """Содержимое — книга: листы с ячейками.

        Проверяется вся форма, а не только её верхушка. Прежняя версия
        смотрела лишь на kind и непустой список листов, поэтому
        `{"cells": ["a", "b"]}` проходила валидацию и падала уже при
        переиндексации — внутри транзакции, без обработчика, с ответом 500.
        Тот же путь ведёт из WebSocket и роняет соединение.
        """
        if not isinstance(value, dict) or value.get("kind") != "sheet":
            raise serializers.ValidationError("Содержимое должно быть книгой таблицы.")

        sheets = value.get("sheets")
        if not isinstance(sheets, list) or not sheets:
            raise serializers.ValidationError("В книге должен быть хотя бы один лист.")
        if len(sheets) > MAX_SHEETS:
            raise serializers.ValidationError(f"Листов в книге не может быть больше {MAX_SHEETS}.")

        total_cells = 0
        for index, sheet in enumerate(sheets, start=1):
            if not isinstance(sheet, dict):
                raise serializers.ValidationError(f"Лист {index} задан неверно.")

            cells = sheet.get("cells", {})
            if not isinstance(cells, dict):
                raise serializers.ValidationError(f"Ячейки листа {index} должны быть объектом.")

            total_cells += len(cells)
            if total_cells > MAX_CELLS:
                raise serializers.ValidationError(
                    f"В книге не может быть больше {MAX_CELLS} ячеек."
                )

            for address, cell in cells.items():
                if not isinstance(address, str) or parse_address(address) is None:
                    raise serializers.ValidationError(
                        f"Адрес ячейки «{address}» на листе {index} неверен."
                    )
                if cell is not None and not isinstance(cell, (dict, str, int, float, bool)):
                    raise serializers.ValidationError(
                        f"Ячейка {address} на листе {index} задана неверно."
                    )
        return value

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Не переданы поля для изменения.")
        return attrs
