"""Публикация: на страницу уходит то, что автор видит в редакторе."""
from rest_framework.test import APITestCase

from apps.users.models import User

FRESH = {
    "kind": "sheet",
    "sheets": [{"id": "s1", "name": "Лист1", "cols": {}, "rows": {},
                "cells": {"A1": {"v": "FRESH"}}}],
}


class PublishLiveStateTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="owner@example.com", password="pass-12345")
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/documents/", {"title": "Отчёт"}, format="json")
        self.document_id = response.data["id"]

    def published_content(self, response):
        self.assertEqual(response.status_code, 201, response.content)
        self.client.force_authenticate(None)
        public = self.client.get(f"/api/published/{response.data['public_id']}/")
        self.assertEqual(public.status_code, 200, public.content)
        return public.data["content"]

    def test_publish_takes_live_state_from_editor(self):
        # Правка последней минуты ещё не дошла до сервера снимком —
        # редактор присылает её вместе с запросом публикации.
        response = self.client.post(
            f"/api/documents/{self.document_id}/publish/",
            {"auto_update": False, "content": FRESH, "state": "AAA="}, format="json",
        )
        self.assertIn("FRESH", str(self.published_content(response)))

    def test_publish_without_live_state_uses_saved_content(self):
        response = self.client.post(f"/api/documents/{self.document_id}/publish/",
                                    {"auto_update": False}, format="json")
        self.assertNotIn("FRESH", str(self.published_content(response)))

    def test_broken_state_is_rejected(self):
        response = self.client.post(
            f"/api/documents/{self.document_id}/publish/",
            {"content": FRESH, "state": "не base64"}, format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
