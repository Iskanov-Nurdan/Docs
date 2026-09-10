"""Аутентификация WebSocket по JWT.

Браузерный WebSocket не умеет слать заголовок Authorization, поэтому токен
приходит параметром запроса. Это осознанный компромисс: адрес с токеном
не должен попадать в логи прокси, поэтому в nginx для /ws/ отключён
access_log с query string.
"""
import logging
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware
from channels.sessions import CookieMiddleware, SessionMiddleware
from django.contrib.auth.models import AnonymousUser

logger = logging.getLogger(__name__)


@database_sync_to_async
def get_user_from_token(raw_token: str):
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    from apps.users.models import User

    try:
        token = AccessToken(raw_token)
        return User.objects.get(id=token["user_id"], is_active=True)
    except (TokenError, KeyError, User.DoesNotExist):
        return AnonymousUser()


class JWTAuthMiddleware(BaseMiddleware):
    async def __call__(self, scope, receive, send):
        query = parse_qs(scope.get("query_string", b"").decode())
        raw_token = (query.get("token") or [""])[0]
        scope["user"] = await get_user_from_token(raw_token) if raw_token else AnonymousUser()
        return await super().__call__(scope, receive, send)


def JWTAuthMiddlewareStack(inner):  # noqa: N802 — принятое в Channels имя
    return CookieMiddleware(SessionMiddleware(JWTAuthMiddleware(inner)))
