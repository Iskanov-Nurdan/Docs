"""API комментариев и предложений правок."""
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.comments.models import Comment, Suggestion
from apps.comments.serializers import (
    CommentCreateSerializer,
    CommentSerializer,
    CommentUpdateSerializer,
    ReactionSerializer,
    SuggestionCreateSerializer,
    SuggestionSerializer,
)
from apps.comments.services import CommentService, SuggestionService
from apps.core.exceptions import NotFoundError
from apps.core.services import client_ip
from apps.documents.models import DocumentActivity
from apps.documents.repositories import DocumentRepository
from apps.documents.services import DocumentService
from apps.permissions.models import Role
from apps.permissions.services import AccessService


def get_document(document_id):
    document = DocumentRepository().by_id(document_id)
    if document is None:
        raise NotFoundError("Документ не найден.")
    return document


def get_comment(comment_id) -> Comment:
    comment = Comment.objects.select_related("document", "user").filter(id=comment_id).first()
    if comment is None:
        raise NotFoundError("Комментарий не найден.")
    return comment


class DocumentCommentsView(APIView):
    def get(self, request, document_id):
        document = get_document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER,
                                link_token=request.query_params.get("link"))

        threads = (
            document.comments.filter(parent__isnull=True)
            .select_related("user", "assignee", "resolved_by")
            .prefetch_related("replies__user", "reactions")
        )
        if request.query_params.get("resolved") == "false":
            threads = threads.filter(is_resolved=False)
        return Response(CommentSerializer(threads, many=True).data)

    def post(self, request, document_id):
        document = get_document(document_id)
        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        comment = CommentService().create(
            user=request.user, document=document, **serializer.validated_data
        )
        DocumentService().log(document=document, user=request.user,
                              action=DocumentActivity.Action.COMMENTED, ip=client_ip(request))
        return Response(CommentSerializer(comment).data, status=status.HTTP_201_CREATED)


class CommentDetailView(APIView):
    def patch(self, request, comment_id):
        comment = get_comment(comment_id)
        serializer = CommentUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = CommentService().update(user=request.user, comment=comment,
                                          content=serializer.validated_data["content"])
        return Response(CommentSerializer(comment).data)

    def delete(self, request, comment_id):
        comment = get_comment(comment_id)
        CommentService().delete(user=request.user, comment=comment)
        return Response(status=status.HTTP_204_NO_CONTENT)


class CommentResolveView(APIView):
    def post(self, request, comment_id):
        comment = get_comment(comment_id)
        comment = CommentService().set_resolved(user=request.user, comment=comment, resolved=True)
        return Response(CommentSerializer(comment).data)


class CommentReopenView(APIView):
    def post(self, request, comment_id):
        comment = get_comment(comment_id)
        comment = CommentService().set_resolved(user=request.user, comment=comment, resolved=False)
        return Response(CommentSerializer(comment).data)


class CommentTaskView(APIView):
    """Отметка задачи выполненной и снятие отметки."""

    def post(self, request, comment_id):
        comment = get_comment(comment_id)
        completed = bool(request.data.get("completed", True))
        comment = CommentService().set_completed(user=request.user, comment=comment,
                                                 completed=completed)
        return Response(CommentSerializer(comment).data)


class CommentReactionView(APIView):
    def post(self, request, comment_id):
        comment = get_comment(comment_id)
        serializer = ReactionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        added = CommentService().toggle_reaction(
            user=request.user, comment=comment, emoji=serializer.validated_data["emoji"]
        )
        return Response({"added": added})


class DocumentSuggestionsView(APIView):
    def get(self, request, document_id):
        document = get_document(document_id)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER,
                                link_token=request.query_params.get("link"))
        suggestions = document.suggestions.select_related("user", "resolved_by")
        state = request.query_params.get("status")
        if state:
            suggestions = suggestions.filter(status=state)
        return Response(SuggestionSerializer(suggestions, many=True).data)

    def post(self, request, document_id):
        document = get_document(document_id)
        serializer = SuggestionCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        suggestion = SuggestionService().create(
            user=request.user, document=document, data=serializer.validated_data
        )
        return Response(SuggestionSerializer(suggestion).data, status=status.HTTP_201_CREATED)


class SuggestionResolveView(APIView):
    """Принятие и отклонение предложенной правки."""

    def post(self, request, suggestion_id):
        suggestion = (
            Suggestion.objects.select_related("document").filter(id=suggestion_id).first()
        )
        if suggestion is None:
            raise NotFoundError("Предложение не найдено.")

        accept = request.data.get("action") == "accept"
        suggestion = SuggestionService().resolve(user=request.user, suggestion=suggestion,
                                                 accept=accept)
        return Response(SuggestionSerializer(suggestion).data)
