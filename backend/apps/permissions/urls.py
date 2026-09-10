from django.urls import path

from apps.permissions.views import (
    DocumentPermissionDetailView,
    DocumentPermissionsView,
    DocumentShareLinkView,
    ResolveShareLinkView,
)

urlpatterns = [
    path("documents/<uuid:document_id>/permissions/", DocumentPermissionsView.as_view(),
         name="document-permissions"),
    path("documents/<uuid:document_id>/permissions/<int:permission_id>/",
         DocumentPermissionDetailView.as_view(), name="document-permission-detail"),
    path("documents/<uuid:document_id>/share-link/", DocumentShareLinkView.as_view(),
         name="document-share-link"),
    path("share/<str:token>/", ResolveShareLinkView.as_view(), name="resolve-share-link"),
]
