"""API истории версий."""
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFoundError
from apps.documents.repositories import DocumentRepository
from apps.permissions.models import Role
from apps.permissions.services import AccessService
from apps.versions.models import DocumentVersion
from apps.versions.serializers import VersionDetailSerializer, VersionListSerializer
from apps.versions.services import VersionService


def _document(document_id):
    document = DocumentRepository().by_id(document_id)
    if document is None:
        raise NotFoundError("Документ не найден.")
    return document


def _version(document_id, version_id) -> DocumentVersion:
    version = (
        DocumentVersion.objects.select_related("user")
        .filter(id=version_id, document_id=document_id)
        .first()
    )
    if version is None:
        raise NotFoundError("Версия не найдена.")
    return version


class DocumentVersionsView(APIView):
    def get(self, request, document_id):
        document = _document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER)
        versions = document.versions.select_related("user")[:200]
        return Response(VersionListSerializer(versions, many=True).data)

    def post(self, request, document_id):
        """Снимок по требованию: «сохранить текущую версию» в меню файла."""
        document = _document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.EDITOR)
        version = VersionService().create_snapshot(
            document=document, user=request.user, label=request.data.get("label", "")[:120]
        )
        return Response(VersionListSerializer(version).data, status=201)


class VersionDetailView(APIView):
    def get(self, request, document_id, version_id):
        document = _document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER)
        version = _version(document_id, version_id)
        return Response(VersionDetailSerializer(version).data)


class VersionRestoreView(APIView):
    def post(self, request, document_id, version_id):
        document = _document(document_id)
        version = _version(document_id, version_id)
        restored = VersionService().restore(user=request.user, document=document, version=version)
        return Response(VersionListSerializer(restored).data)
