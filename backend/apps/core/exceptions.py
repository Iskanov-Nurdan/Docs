"""Ошибки приложения и единый формат ответа."""
import logging

from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


class BusinessError(Exception):
    """Нарушение правила предметной области: показывается пользователю как есть."""

    status_code = status.HTTP_400_BAD_REQUEST

    def __init__(self, message: str, code: str = "business_error"):
        super().__init__(message)
        self.message = message
        self.code = code


class NotFoundError(BusinessError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, message: str = "Объект не найден."):
        super().__init__(message, code="not_found")


class AccessDeniedError(BusinessError):
    status_code = status.HTTP_403_FORBIDDEN

    def __init__(self, message: str = "Недостаточно прав."):
        super().__init__(message, code="access_denied")


def api_exception_handler(exc, context):
    """Один формат ошибки на всё API: {detail, code, fields}."""
    if isinstance(exc, BusinessError):
        return Response(
            {"detail": exc.message, "code": exc.code},
            status=exc.status_code,
        )

    if isinstance(exc, Http404):
        return Response({"detail": "Объект не найден.", "code": "not_found"}, status=404)

    if isinstance(exc, DjangoPermissionDenied):
        return Response({"detail": "Недостаточно прав.", "code": "access_denied"}, status=403)

    response = exception_handler(exc, context)
    if response is None:
        # Внутреннюю ошибку наружу не отдаём: она уходит в лог целиком,
        # а клиент получает только факт сбоя.
        logger.exception("Необработанная ошибка: %s", exc)
        return Response(
            {"detail": "Внутренняя ошибка сервера.", "code": "server_error"},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    data = response.data
    if isinstance(data, dict) and "detail" in data:
        response.data = {"detail": str(data["detail"]), "code": getattr(exc, "default_code", "error")}
    elif isinstance(data, dict):
        # Ошибки валидации по полям — форма подсветит нужные поля.
        response.data = {
            "detail": "Проверьте заполненные поля.",
            "code": "validation_error",
            "fields": data,
        }
    return response
