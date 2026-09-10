from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.documents.views import DocumentSearchView, DocumentViewSet, FolderViewSet

router = DefaultRouter()
router.register("documents", DocumentViewSet, basename="document")
router.register("folders", FolderViewSet, basename="folder")

urlpatterns = [
    path("documents/search/", DocumentSearchView.as_view(), name="document-search"),
    path("", include(router.urls)),
]
