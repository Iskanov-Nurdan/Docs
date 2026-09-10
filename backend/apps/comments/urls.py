from django.urls import path

from apps.comments.views import (
    CommentDetailView,
    CommentReactionView,
    CommentReopenView,
    CommentResolveView,
    CommentTaskView,
    DocumentCommentsView,
    DocumentSuggestionsView,
    SuggestionResolveView,
)

urlpatterns = [
    path("documents/<uuid:document_id>/comments/", DocumentCommentsView.as_view(),
         name="document-comments"),
    path("comments/<uuid:comment_id>/", CommentDetailView.as_view(), name="comment-detail"),
    path("comments/<uuid:comment_id>/resolve/", CommentResolveView.as_view(),
         name="comment-resolve"),
    path("comments/<uuid:comment_id>/reopen/", CommentReopenView.as_view(), name="comment-reopen"),
    path("comments/<uuid:comment_id>/task/", CommentTaskView.as_view(), name="comment-task"),
    path("comments/<uuid:comment_id>/reactions/", CommentReactionView.as_view(),
         name="comment-reactions"),
    path("documents/<uuid:document_id>/suggestions/", DocumentSuggestionsView.as_view(),
         name="document-suggestions"),
    path("suggestions/<uuid:suggestion_id>/resolve/", SuggestionResolveView.as_view(),
         name="suggestion-resolve"),
]
