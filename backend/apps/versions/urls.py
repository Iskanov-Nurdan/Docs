from django.urls import path

from apps.versions.views import DocumentVersionsView, VersionDetailView, VersionRestoreView

urlpatterns = [
    path("documents/<uuid:document_id>/versions/", DocumentVersionsView.as_view(),
         name="document-versions"),
    path("documents/<uuid:document_id>/versions/<uuid:version_id>/", VersionDetailView.as_view(),
         name="version-detail"),
    path("documents/<uuid:document_id>/versions/<uuid:version_id>/restore/",
         VersionRestoreView.as_view(), name="version-restore"),
]
