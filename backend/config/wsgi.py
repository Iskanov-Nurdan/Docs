"""WSGI — только для команд и синхронных задач; боевой сервер работает по ASGI."""
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

application = get_wsgi_application()
