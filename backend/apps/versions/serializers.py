"""Схемы истории версий."""
import base64

from rest_framework import serializers

from apps.users.serializers import UserShortSerializer
from apps.versions.models import DocumentVersion


class VersionListSerializer(serializers.ModelSerializer):
    """Строка в истории: без содержимого, оно тяжёлое."""

    user = UserShortSerializer(read_only=True)

    class Meta:
        model = DocumentVersion
        fields = ("id", "version_number", "user", "label", "metadata", "created_at")
        read_only_fields = fields


class VersionDetailSerializer(serializers.ModelSerializer):
    user = UserShortSerializer(read_only=True)
    # Полное состояние Yjs версии (с оформлением, ширинами, фильтрами) —
    # редактор восстанавливает по нему таблицу. В content только значения.
    ydoc_state = serializers.SerializerMethodField()

    class Meta:
        model = DocumentVersion
        fields = ("id", "version_number", "user", "label", "metadata", "content", "ydoc_state",
                  "created_at")
        read_only_fields = fields

    def get_ydoc_state(self, version: DocumentVersion) -> str | None:
        state = version.ydoc_state
        return base64.b64encode(bytes(state)).decode("ascii") if state else None
