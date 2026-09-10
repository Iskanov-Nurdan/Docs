from django.urls import path

from apps.files.views import (
    DocumentExportView,
    DocumentImportView,
    ExportStatusView,
    ImageUploadView,
)

urlpatterns = [
    path("files/images/", ImageUploadView.as_view(), name="image-upload"),
    path("documents/import/", DocumentImportView.as_view(), name="document-import"),
    path("documents/<uuid:document_id>/export/", DocumentExportView.as_view(),
         name="document-export"),
    path("exports/<str:task_id>/", ExportStatusView.as_view(), name="export-status"),
]
