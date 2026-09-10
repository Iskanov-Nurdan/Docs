"""Журнал запросов: метод, путь, пользователь, код ответа, длительность."""
import logging
import time

logger = logging.getLogger("apps.request")

# Пути, которые опрашиваются постоянно: в логе от них только шум.
QUIET_PATHS = ("/health/", "/static/", "/media/")


class RequestLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = time.monotonic()
        response = self.get_response(request)
        if request.path.startswith(QUIET_PATHS):
            return response

        elapsed_ms = (time.monotonic() - started) * 1000
        user = getattr(request, "user", None)
        # В лог идут только метаданные: тело запроса может содержать
        # пароль или текст документа.
        logger.info(
            "%s %s -> %s за %.0f мс (пользователь: %s)",
            request.method,
            request.path,
            response.status_code,
            elapsed_ms,
            getattr(user, "email", "аноним") if user and user.is_authenticated else "аноним",
        )
        return response
