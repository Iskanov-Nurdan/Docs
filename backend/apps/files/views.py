"""API файлов: загрузка изображений, импорт и выгрузка документов."""
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import BusinessError, NotFoundError
from apps.core.services import client_ip
from apps.documents.models import DocumentActivity
from apps.documents.repositories import DocumentRepository
from apps.documents.services import DocumentService
from apps.files.models import StoredFile
from apps.files.services import FileService
from apps.permissions.models import Role
from apps.permissions.services import AccessService

EXPORT_FORMATS = {"pdf", "docx", "txt", "html", "rtf", "odt"}


class StoredFileSerializer(serializers.ModelSerializer):
    url = serializers.SerializerMethodField()

    class Meta:
        model = StoredFile
        fields = ("id", "kind", "url", "original_name", "content_type", "size",
                  "width", "height", "created_at")
        read_only_fields = fields

    def get_url(self, stored: StoredFile) -> str:
        return stored.file.url


class ImageUploadView(APIView):
    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            raise BusinessError("Файл не передан.", code="no_file")

        document = None
        document_id = request.data.get("document_id")
        if document_id:
            document = DocumentRepository().by_id(document_id)
            if document is None:
                raise NotFoundError("Документ не найден.")
            # Картинку кладут в документ — значит, нужно право его править.
            AccessService().require(user=request.user, document=document, minimum=Role.EDITOR)

        stored = FileService().upload_image(user=request.user, upload=upload, document=document)
        return Response(StoredFileSerializer(stored).data, status=status.HTTP_201_CREATED)


class DocumentImportView(APIView):
    """Загрузка DOCX, TXT и HTML: файл принимается, разбор идёт в фоне."""

    parser_classes = (MultiPartParser, FormParser)

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            raise BusinessError("Файл не передан.", code="no_file")

        stored = FileService().upload_import(user=request.user, upload=upload)

        from apps.files.tasks import import_document

        task = import_document.delay(str(stored.id), str(request.user.id))
        return Response(
            {"file": StoredFileSerializer(stored).data, "task_id": task.id},
            status=status.HTTP_202_ACCEPTED,
        )


class DocumentExportView(APIView):
    """Выгрузка документа. Тяжёлые форматы готовятся в фоне."""

    throttle_scope = "export"

    def get(self, request, document_id):
        document = DocumentRepository().by_id(document_id)
        if document is None:
            raise NotFoundError("Документ не найден.")

        role = AccessService().require(user=request.user, document=document, minimum=Role.VIEWER)
        if not AccessService().can_download(user=request.user, document=document, role=role):
            raise BusinessError("Владелец запретил скачивание документа.", code="download_denied")

        export_format = request.query_params.get("format", "pdf").lower()
        if export_format not in EXPORT_FORMATS:
            raise BusinessError(
                f"Неизвестный формат. Доступны: {', '.join(sorted(EXPORT_FORMATS))}.",
                code="unknown_format",
            )

        DocumentService().log(document=document, user=request.user,
                              action=DocumentActivity.Action.DOWNLOADED, ip=client_ip(request),
                              metadata={"format": export_format})

        from apps.files.tasks import export_document

        task = export_document.delay(str(document.id), export_format, str(request.user.id))
        return Response({"task_id": task.id, "format": export_format},
                        status=status.HTTP_202_ACCEPTED)


class ExportStatusView(APIView):
    """Опрос готовности выгрузки: клиент ждёт ссылку на файл."""

    def get(self, request, task_id):
        from celery.result import AsyncResult

        result = AsyncResult(task_id)
        if not result.ready():
            return Response({"status": "processing"})
        if result.failed():
            return Response({"status": "failed"}, status=status.HTTP_400_BAD_REQUEST)

        payload = result.get()
        stored = StoredFile.objects.filter(id=payload.get("file_id")).first()
        if stored is None:
            return Response({"status": "failed"}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"status": "ready", "file": StoredFileSerializer(stored).data})
