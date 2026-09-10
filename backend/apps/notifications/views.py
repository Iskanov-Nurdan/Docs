"""API уведомлений."""
from rest_framework import serializers, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import NotFoundError
from apps.notifications.models import Notification
from apps.users.serializers import UserShortSerializer


class NotificationSerializer(serializers.ModelSerializer):
    actor = UserShortSerializer(read_only=True)
    type_display = serializers.CharField(source="get_type_display", read_only=True)
    document_title = serializers.CharField(source="document.title", read_only=True, default="")

    class Meta:
        model = Notification
        fields = ("id", "type", "type_display", "actor", "document", "document_title",
                  "comment", "message", "is_read", "created_at")
        read_only_fields = fields


class NotificationListView(APIView):
    def get(self, request):
        notifications = request.user.notifications.select_related("actor", "document")
        if request.query_params.get("unread") == "true":
            notifications = notifications.filter(is_read=False)

        from apps.core.pagination import DefaultPagination

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(notifications, request)
        data = NotificationSerializer(page, many=True).data
        response = paginator.get_paginated_response(data)
        response.data["unread_count"] = request.user.notifications.filter(is_read=False).count()
        return response


class NotificationReadView(APIView):
    def post(self, request, notification_id):
        notification = request.user.notifications.filter(id=notification_id).first()
        if notification is None:
            raise NotFoundError("Уведомление не найдено.")
        notification.is_read = True
        notification.save(update_fields=["is_read", "updated_at"])
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    def post(self, request):
        updated = request.user.notifications.filter(is_read=False).update(is_read=True)
        return Response({"updated": updated}, status=status.HTTP_200_OK)
