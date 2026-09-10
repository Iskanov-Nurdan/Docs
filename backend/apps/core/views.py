from django.db import connection
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class HealthView(APIView):
    """GET /health/ — живость сервиса и доступность базы."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        try:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
            database = "ok"
        except Exception:  # noqa: BLE001 — наружу отдаём только факт сбоя
            database = "error"

        payload = {"status": "ok" if database == "ok" else "degraded", "database": database}
        return Response(payload, status=200 if database == "ok" else 503)
