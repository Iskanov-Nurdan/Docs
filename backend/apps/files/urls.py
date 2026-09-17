from django.urls import path

from apps.files.views import (
    DocumentExportView,
    DocumentImportView,
    DocumentSheetImportView,
    ExportStatusView,
    ImageUploadView,
)

urlpatterns = [
    path("files/images/", ImageUploadView.as_view(), name="image-upload"),
    # Раньше маршрутизатора документов: иначе «documents/import/» попал бы
    # в documents/<pk>/ и «import» разбиралось бы как идентификатор.
    path("documents/import/", DocumentImportView.as_view(), name="document-import"),
    path("documents/<uuid:document_id>/import/", DocumentSheetImportView.as_view(),
         name="document-sheet-import"),
    path("documents/<uuid:document_id>/export/", DocumentExportView.as_view(),
         name="document-export"),
    path("exports/<str:task_id>/", ExportStatusView.as_view(), name="export-status"),
]
