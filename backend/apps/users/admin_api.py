"""Администрирование пользователей.

Самостоятельной регистрации в системе нет: учётные записи заводит
администратор. Поэтому здесь же и создание человека — с паролем, который
администратор передаёт ему лично.

Прав два уровня, и они разные по последствиям:

* **администратор** (`is_staff`) — видит список людей и сводку, может
  закрыть доступ нарушителю;
* **главный админ** (`is_superuser`) — вдобавок назначает и снимает
  администраторов. Раздача прав — самое опасное действие в системе, поэтому
  она отделена: обычный администратор не может ни повысить себя, ни развести
  админов до состояния, когда систему некому чинить.

Правила защиты от выстрела в ногу собраны в сервисе, а не в представлении:
проверка «нельзя снять последнего главного админа» должна работать одинаково
и из API, и из консоли.
"""
import logging
import secrets

from django.contrib.auth.password_validation import validate_password
from django.db.models import Count, Q
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import AccessDeniedError, BusinessError, NotFoundError
from apps.core.pagination import DefaultPagination
from apps.core.permissions import IsAdmin
from apps.documents.models import Document
from apps.users.models import User
from apps.users.services import CURSOR_COLORS

logger = logging.getLogger(__name__)


class AdminUserSerializer(serializers.ModelSerializer):
    display_name = serializers.CharField(read_only=True)
    documents_count = serializers.IntegerField(read_only=True, default=0)
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "display_name", "first_name", "last_name", "avatar",
                  "role", "is_active", "is_staff", "is_superuser", "email_confirmed",
                  "documents_count", "created_at", "last_login")
        read_only_fields = fields

    def get_role(self, user: User) -> str:
        if user.is_superuser:
            return "owner"
        return "admin" if user.is_staff else "member"


class AdminUserCreateSerializer(serializers.Serializer):
    """Новая учётная запись. Пароль задаёт администратор."""

    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, min_length=8)
    first_name = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    last_name = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    role = serializers.ChoiceField(choices=["member", "admin"], required=False, default="member")

    def validate_email(self, value: str) -> str:
        return value.strip().lower()

    def validate_password(self, value: str) -> str:
        """Те же правила, что при смене и сбросе пароля.

        Самостоятельной регистрации в системе нет, и это единственное место,
        где заводится учётная запись. Без проверки сюда проходил пароль
        «12345678» — а смена того же пароля из профиля его бы не приняла.
        """
        validate_password(value)
        return value


class AdminUserUpdateSerializer(serializers.Serializer):
    """Меняется одно из двух: уровень прав или доступ в систему."""

    role = serializers.ChoiceField(choices=["member", "admin"], required=False)
    is_active = serializers.BooleanField(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError("Не переданы поля для изменения.")
        return attrs


class AdminService:
    def users(self, query: str = ""):
        queryset = User.objects.annotate(
            documents_count=Count("documents", filter=Q(documents__deleted_at__isnull=True))
        )
        query = (query or "").strip()
        if query:
            queryset = queryset.filter(
                Q(email__icontains=query)
                | Q(first_name__icontains=query)
                | Q(last_name__icontains=query)
            )
        # Сначала те, кто управляет системой: их всегда единицы, и искать их
        # в конце списка из тысячи человек неудобно.
        return queryset.order_by("-is_superuser", "-is_staff", "email")

    def summary(self) -> dict:
        return {
            "users": User.objects.count(),
            "active_users": User.objects.filter(is_active=True).count(),
            "admins": User.objects.filter(is_staff=True).count(),
            "documents": Document.objects.filter(deleted_at__isnull=True).count(),
            "trashed": Document.objects.filter(deleted_at__isnull=False).count(),
        }

    def create(self, *, actor: User, data: dict) -> User:
        if data["role"] == "admin" and not actor.is_superuser:
            raise AccessDeniedError("Назначать администраторов может только главный админ.")
        if User.objects.filter(email=data["email"]).exists():
            raise BusinessError("Пользователь с таким email уже заведён.", code="email_taken")

        user = User.objects.create_user(
            email=data["email"],
            password=data["password"],
            first_name=data.get("first_name", ""),
            last_name=data.get("last_name", ""),
            cursor_color=secrets.choice(CURSOR_COLORS),
        )
        # Адрес подтверждать не просим: учётную запись завёл администратор,
        # он же и передаёт пароль — письмо здесь ничего не проверяет.
        user.email_confirmed = True
        user.is_staff = data["role"] == "admin"
        user.save(update_fields=["email_confirmed", "is_staff", "updated_at"])

        logger.info("Администратор %s завёл пользователя %s", actor.email, user.email)
        return user

    def update(self, *, actor: User, target: User, data: dict) -> User:
        if target.is_superuser and actor.id != target.id and not actor.is_superuser:
            raise AccessDeniedError("Главного админа может менять только главный админ.")

        if "role" in data:
            if not actor.is_superuser:
                raise AccessDeniedError("Назначать администраторов может только главный админ.")
            if target.is_superuser:
                raise BusinessError("Права главного админа снимаются только в консоли сервера.",
                                     code="superuser_protected")
            target.is_staff = data["role"] == "admin"

        if "is_active" in data:
            if actor.id == target.id:
                raise BusinessError("Нельзя закрыть доступ самому себе.", code="self_block")
            if target.is_superuser:
                raise BusinessError("Главному админу нельзя закрыть доступ.",
                                     code="superuser_protected")
            # Администратора закрывает только главный админ. Иначе двое
            # обычных администраторов могли погасить друг друга, и система
            # осталась бы без тех, кто может её чинить — ровно то, от чего
            # оберегает описание этого модуля.
            if target.is_staff and not actor.is_superuser:
                raise AccessDeniedError("Закрыть доступ администратору может только главный админ.")
            target.is_active = data["is_active"]

        target.save(update_fields=["is_staff", "is_active", "updated_at"])
        return target


class AdminUsersView(APIView):
    permission_classes = (IsAdmin,)

    def get(self, request):
        queryset = AdminService().users(request.query_params.get("q", ""))
        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        return paginator.get_paginated_response(AdminUserSerializer(page, many=True).data)

    def post(self, request):
        serializer = AdminUserCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = AdminService().create(actor=request.user, data=serializer.validated_data)
        created = AdminService().users().filter(id=user.id).first()
        return Response(AdminUserSerializer(created).data, status=status.HTTP_201_CREATED)


class AdminUserDetailView(APIView):
    permission_classes = (IsAdmin,)

    def patch(self, request, user_id):
        target = User.objects.filter(id=user_id).first()
        if target is None:
            raise NotFoundError("Пользователь не найден.")

        serializer = AdminUserUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        updated = AdminService().update(
            actor=request.user, target=target, data=serializer.validated_data
        )
        # Пересчитываем документы: сериализатор ждёт это поле от выборки.
        updated = AdminService().users().filter(id=updated.id).first()
        return Response(AdminUserSerializer(updated).data)


class AdminSummaryView(APIView):
    permission_classes = (IsAdmin,)

    def get(self, request):
        return Response(AdminService().summary())
