"""Схемы прав доступа."""
from rest_framework import serializers

from apps.permissions.models import DocumentPermission, DocumentShareLink, LinkAccess, Role
from apps.users.serializers import UserShortSerializer


class PermissionSerializer(serializers.ModelSerializer):
    user = UserShortSerializer(read_only=True)
    role_display = serializers.CharField(source="get_role_display", read_only=True)

    class Meta:
        model = DocumentPermission
        fields = ("id", "user", "role", "role_display", "created_at")
        read_only_fields = fields

    @staticmethod
    def owner_payload(owner) -> dict:
        """Владелец не хранится строкой в таблице прав — он поле документа."""
        return {
            "user": UserShortSerializer(owner).data,
            "role": Role.OWNER,
            "role_display": Role.OWNER.label,
        }


class PermissionGrantSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254, required=False)
    role = serializers.ChoiceField(
        # Владелец в списке отсутствует: передача владения — отдельное действие
        # с подтверждением, а не смена роли в общем списке.
        choices=[Role.EDITOR, Role.COMMENTER, Role.VIEWER],
        required=False,
    )

    def validate_email(self, value: str) -> str:
        return value.strip().lower()


class ShareLinkSerializer(serializers.ModelSerializer):
    role_display = serializers.CharField(source="get_role_display", read_only=True)
    access_display = serializers.CharField(source="get_access_display", read_only=True)

    class Meta:
        model = DocumentShareLink
        fields = ("id", "token", "role", "role_display", "access", "access_display",
                  "expires_at", "is_active", "created_at")
        read_only_fields = fields


class ShareLinkUpdateSerializer(serializers.Serializer):
    access = serializers.ChoiceField(choices=LinkAccess.choices)
    role = serializers.ChoiceField(
        choices=[Role.EDITOR, Role.COMMENTER, Role.VIEWER], required=False
    )
    expires_at = serializers.DateTimeField(required=False, allow_null=True)
