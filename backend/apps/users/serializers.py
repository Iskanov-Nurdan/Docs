"""Схемы входных и выходных данных пользователей."""
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from apps.core.services import plain_text
from apps.users.models import Theme, User


class UserShortSerializer(serializers.ModelSerializer):
    """Как пользователь выглядит в чужих документах: автор, курсор, комментарий."""

    display_name = serializers.CharField(read_only=True)
    initials = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "display_name", "initials",
                  "avatar", "cursor_color")
        read_only_fields = fields


class UserProfileSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)

    class Meta:
        model = User
        fields = ("id", "email", "first_name", "last_name", "display_name", "avatar",
                  "language", "theme", "email_notifications", "editor_settings",
                  "cursor_color", "email_confirmed", "is_staff", "created_at")
        read_only_fields = ("id", "email", "email_confirmed", "is_staff", "created_at")


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, max_length=128)
    first_name = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    last_name = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

    def validate_password(self, value: str) -> str:
        validate_password(value)
        return value

    def validate_first_name(self, value: str) -> str:
        return plain_text(value)

    def validate_last_name(self, value: str) -> str:
        return plain_text(value)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True, max_length=128)


class ProfileUpdateSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=60, required=False, allow_blank=True)
    last_name = serializers.CharField(max_length=60, required=False, allow_blank=True)
    avatar = serializers.ImageField(required=False, allow_null=True)
    language = serializers.ChoiceField(choices=["ru", "ky", "en"], required=False)
    theme = serializers.ChoiceField(choices=Theme.choices, required=False)
    email_notifications = serializers.BooleanField(required=False)
    editor_settings = serializers.JSONField(required=False)

    def validate_first_name(self, value: str) -> str:
        return plain_text(value)

    def validate_last_name(self, value: str) -> str:
        return plain_text(value)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Не переданы поля для изменения.")
        return attrs


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, max_length=128)
    new_password = serializers.CharField(write_only=True, max_length=128)

    def validate_new_password(self, value: str) -> str:
        validate_password(value)
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)


class PasswordResetConfirmSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=128)
    new_password = serializers.CharField(write_only=True, max_length=128)

    def validate_new_password(self, value: str) -> str:
        validate_password(value)
        return value
