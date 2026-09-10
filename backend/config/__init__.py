"""Конфигурация проекта.

Celery импортируется здесь, чтобы декоратор @shared_task находил приложение
при любом способе запуска.
"""
from config.celery import app as celery_app

__all__ = ("celery_app",)
