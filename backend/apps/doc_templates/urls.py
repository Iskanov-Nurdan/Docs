from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.doc_templates.views import TemplateViewSet

router = DefaultRouter()
router.register("templates", TemplateViewSet, basename="template")

urlpatterns = [path("", include(router.urls))]
