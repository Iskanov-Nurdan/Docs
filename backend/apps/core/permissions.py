"""Проверки доступа, общие для всего API."""
from rest_framework.permissions import BasePermission


class IsAdmin(BasePermission):
    """Административная часть: пользователи, шаблоны, статистика."""

    message = "Действие доступно администратору."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_staff)


class IsAccountantOrAdmin(BasePermission):
    """Общая финансовая сводка доступна бухгалтеру и администраторам."""

    message = "Действие доступно бухгалтеру."

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and (user.is_accountant or user.is_staff))
