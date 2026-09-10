"""Маршруты HTTP-части. Realtime живёт в config/routing.py."""
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from apps.core.views import HealthView

urlpatterns = [
    path("django-admin/", admin.site.urls),
    path("health/", HealthView.as_view(), name="health"),
    path("api/", include("apps.users.urls")),
    path("api/", include("apps.documents.urls")),
    path("api/", include("apps.permissions.urls")),
    path("api/", include("apps.comments.urls")),
    path("api/", include("apps.versions.urls")),
    path("api/", include("apps.notifications.urls")),
    path("api/", include("apps.doc_templates.urls")),
    path("api/", include("apps.files.urls")),
    path("api/", include("apps.publishing.urls")),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
