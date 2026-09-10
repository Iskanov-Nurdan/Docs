"""Публикация документа в вебе."""
import secrets

from django.db.models import F
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFoundError
from apps.core.services import client_ip
from apps.documents.models import DocumentActivity
from apps.documents.repositories import DocumentRepository
from apps.documents.services import DocumentService
from apps.permissions.models import Role
from apps.permissions.services import AccessService
from apps.publishing.models import PublishedDocument


class PublicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = PublishedDocument
        fields = ("id", "public_id", "title", "is_active", "auto_update", "views_count",
                  "created_at", "updated_at")
        read_only_fields = ("id", "public_id", "views_count", "created_at", "updated_at")


class DocumentPublishView(APIView):
    """Публикация, обновление и снятие с публикации."""

    def _document(self, document_id):
        document = DocumentRepository().by_id(document_id)
        if document is None:
            raise NotFoundError("Документ не найден.")
        return document

    def get(self, request, document_id):
        document = self._document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER)
        publication = getattr(document, "publication", None)
        if publication is None:
            return Response({"published": False})
        return Response({"published": True, **PublicationSerializer(publication).data})

    def post(self, request, document_id):
        document = self._document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.OWNER)

        publication = getattr(document, "publication", None)
        if publication is None:
            publication = PublishedDocument(
                document=document,
                public_id=secrets.token_urlsafe(12),
                published_by=request.user,
            )

        # Снимок содержимого: опубликованная страница не должна меняться
        # от каждой правки черновика, пока автор сам не обновит её.
        publication.content = document.content
        publication.title = document.title
        publication.is_active = True
        publication.auto_update = bool(request.data.get("auto_update", False))
        publication.save()

        document.is_published = True
        document.save(update_fields=["is_published", "updated_at"])

        DocumentService().log(document=document, user=request.user,
                              action=DocumentActivity.Action.PUBLISHED, ip=client_ip(request))
        return Response(PublicationSerializer(publication).data, status=status.HTTP_201_CREATED)

    def delete(self, request, document_id):
        document = self._document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.OWNER)

        publication = getattr(document, "publication", None)
        if publication is not None:
            publication.is_active = False
            publication.save(update_fields=["is_active", "updated_at"])

        document.is_published = False
        document.save(update_fields=["is_published", "updated_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class PublicDocumentView(APIView):
    """Чтение опубликованного документа — единственная точка без входа в систему."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request, public_id):
        publication = (
            PublishedDocument.objects.select_related("document")
            .filter(public_id=public_id, is_active=True)
            .first()
        )
        if publication is None or publication.document.deleted_at is not None:
            raise NotFoundError("Страница не найдена.")

        # Счётчик обновляется запросом к базе, а не чтением и записью:
        # иначе одновременные открытия теряли бы часть просмотров.
        PublishedDocument.objects.filter(pk=publication.pk).update(
            views_count=F("views_count") + 1
        )

        content = (
            publication.document.content if publication.auto_update else publication.content
        )
        return Response({
            "public_id": publication.public_id,
            "title": publication.title,
            "content": content,
            "published_at": publication.created_at,
            "updated_at": publication.updated_at,
        })
