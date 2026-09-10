"""Схемы комментариев и предложений."""
from collections import Counter

from rest_framework import serializers

from apps.comments.models import Comment, Suggestion
from apps.users.serializers import UserShortSerializer


class CommentReplySerializer(serializers.ModelSerializer):
    user = UserShortSerializer(read_only=True)

    class Meta:
        model = Comment
        fields = ("id", "user", "content", "created_at", "updated_at")
        read_only_fields = fields


class CommentSerializer(serializers.ModelSerializer):
    user = UserShortSerializer(read_only=True)
    assignee = UserShortSerializer(read_only=True)
    resolved_by = UserShortSerializer(read_only=True)
    replies = CommentReplySerializer(many=True, read_only=True)
    reactions = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ("id", "user", "content", "selection_data", "quoted_text",
                  "is_resolved", "resolved_by", "resolved_at",
                  "assignee", "is_completed", "replies", "reactions",
                  "created_at", "updated_at")
        read_only_fields = fields

    def get_reactions(self, comment: Comment) -> list[dict]:
        """Реакции сворачиваются в счётчики: список из сорока пальцев не нужен."""
        counts = Counter(reaction.emoji for reaction in comment.reactions.all())
        return [{"emoji": emoji, "count": count} for emoji, count in counts.most_common()]


class CommentCreateSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=5000)
    selection_data = serializers.JSONField(required=False)
    quoted_text = serializers.CharField(max_length=2000, required=False, allow_blank=True,
                                        default="")
    parent_id = serializers.UUIDField(required=False, allow_null=True)
    assignee_email = serializers.EmailField(required=False, allow_blank=True, default="")


class CommentUpdateSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=5000)


class ReactionSerializer(serializers.Serializer):
    emoji = serializers.CharField(max_length=8)


class SuggestionSerializer(serializers.ModelSerializer):
    user = UserShortSerializer(read_only=True)
    resolved_by = UserShortSerializer(read_only=True)
    status_display = serializers.CharField(source="get_status_display", read_only=True)
    operation_display = serializers.CharField(source="get_operation_display", read_only=True)

    class Meta:
        model = Suggestion
        fields = ("id", "user", "operation", "operation_display", "position", "content",
                  "original_text", "suggested_text", "status", "status_display",
                  "resolved_by", "resolved_at", "created_at")
        read_only_fields = fields


class SuggestionCreateSerializer(serializers.Serializer):
    operation = serializers.ChoiceField(choices=Suggestion.Operation.choices)
    position = serializers.JSONField()
    content = serializers.JSONField(required=False, default=dict)
    original_text = serializers.CharField(max_length=10000, required=False, allow_blank=True,
                                          default="")
    suggested_text = serializers.CharField(max_length=10000, required=False, allow_blank=True,
                                           default="")
