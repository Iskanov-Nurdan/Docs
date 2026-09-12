"""HTTP-слой пользователей: только разбор запроса и вызов сервиса."""
from django.contrib.auth import update_session_auth_hash
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView

from apps.core.exceptions import BusinessError
from apps.users.repositories import UserRepository
from apps.users.serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    ProfileUpdateSerializer,
    UserProfileSerializer,
    UserShortSerializer,
)
from apps.users.services import UserService


class LoginView(APIView):
    permission_classes = (AllowAny,)
    throttle_scope = "login"

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tokens = UserService().login(**serializer.validated_data)
        user = UserRepository().by_email(serializer.validated_data["email"])
        return Response({"user": UserProfileSerializer(user).data, **tokens})


class LogoutView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request):
        """Отзывает refresh-токен: выход должен закрывать сессию везде."""
        raw_token = request.data.get("refresh")
        if not raw_token:
            raise BusinessError("Не передан refresh-токен.")
        try:
            RefreshToken(raw_token).blacklist()
        except TokenError:
            # Повторный выход не ошибка: токен уже недействителен.
            pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionRefreshView(TokenRefreshView):
    """Продление сессии: пока пользователь работает, вход не требуется."""

    permission_classes = (AllowAny,)


class ConfirmEmailView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        token = request.data.get("token", "")
        user = UserService().confirm_email(token)
        return Response({"user": UserProfileSerializer(user).data})


class PasswordResetRequestView(APIView):
    permission_classes = (AllowAny,)
    throttle_scope = "login"

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        UserService().request_password_reset(serializer.validated_data["email"])
        # Ответ одинаковый в любом случае — существование адреса не раскрываем.
        return Response({"detail": "Если адрес зарегистрирован, письмо отправлено."})


class PasswordResetConfirmView(APIView):
    permission_classes = (AllowAny,)

    def post(self, request):
        serializer = PasswordResetConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        UserService().reset_password(**serializer.validated_data)
        return Response({"detail": "Пароль изменён."})


class ChangePasswordView(APIView):
    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = UserService().change_password(user=request.user, **serializer.validated_data)
        update_session_auth_hash(request, user)
        return Response({"detail": "Пароль изменён."})


class MeView(APIView):
    def get(self, request):
        return Response(UserProfileSerializer(request.user).data)

    def patch(self, request):
        serializer = ProfileUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        user = UserService().update_profile(user=request.user, data=serializer.validated_data)
        return Response(UserProfileSerializer(user).data)


class UserSearchView(APIView):
    """Подсказка адресатов при выдаче доступа и упоминаниях."""

    def get(self, request):
        users = UserRepository().search(request.query_params.get("q", ""))
        return Response(UserShortSerializer(users, many=True).data)
