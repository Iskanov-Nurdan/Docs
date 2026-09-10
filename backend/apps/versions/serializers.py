"""Схемы истории версий."""
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

    class Meta:
        model = DocumentVersion
        fields = ("id", "version_number", "user", "label", "metadata", "content", "created_at")
        read_only_fields = fields
