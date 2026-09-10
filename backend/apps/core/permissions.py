"""Проверки доступа, общие для всего API."""
from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    """Административная часть: пользователи, шаблоны, статистика."""

    message = "Действие доступно администратору."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_staff)
