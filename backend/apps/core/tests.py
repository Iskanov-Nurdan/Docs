"""Проверки доступа.

Таблицы в конторе общие (AccessService.role_for): любой вошедший сотрудник —
редактор чужих документов. Под замком остаётся то, что принадлежит владельцу:
удаление, раздача доступа, личные шаблоны и папки, чужие комментарии.
Ответ «не найден» и «нет доступа» одинаково годятся.
"""
from rest_framework.test import APITestCase

from apps.comments.models import Comment
from apps.doc_templates.models import DocumentTemplate
from apps.documents.models import Document, Folder
from apps.users.models import User

DENIED = {403, 404}


class AccessTests(APITestCase):
    def setUp(self):
        self.owner = User.objects.create_user(email="owner@example.com", password="pass-12345")
        self.stranger = User.objects.create_user(email="stranger@example.com",
                                                 password="pass-12345")
        self.client.force_authenticate(self.owner)
        response = self.client.post("/api/documents/", {"title": "Секрет"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.document = Document.objects.get(id=response.data["id"])
        response = self.client.post(f"/api/documents/{self.document.id}/comments/",
                                    {"content": "Заметка"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.comment = Comment.objects.get(id=response.data["id"])
        self.client.force_authenticate(self.stranger)

    def assertDenied(self, response):
        self.assertIn(response.status_code, DENIED, response.content)

    def test_coworker_edits_but_cannot_manage(self):
        # Таблицы в конторе общие: сотрудник читает и правит чужой документ,
        # но удалять, раздавать доступ и менять ссылку может только владелец.
        doc = f"/api/documents/{self.document.id}/"
        self.assertEqual(self.client.get(doc).status_code, 200)
        self.assertDenied(self.client.delete(doc))
        self.assertDenied(self.client.delete(doc + "?permanent=true"))
        self.assertDenied(self.client.put(doc + "share-link/", {"access": "anyone"},
                                          format="json"))
        self.assertDenied(self.client.post(doc + "permissions/",
                                           {"email": "stranger@example.com", "role": "editor"},
                                           format="json"))
        self.document.refresh_from_db()
        self.assertIsNone(self.document.deleted_at)
        self.assertFalse(self.document.share_links.filter(access="anyone").exists())

    def test_foreign_comment_is_read_only(self):
        comment = f"/api/comments/{self.comment.id}/"
        self.assertDenied(self.client.patch(comment, {"content": "взлом"}, format="json"))
        self.assertDenied(self.client.delete(comment))
        self.assertTrue(Comment.objects.filter(id=self.comment.id, content="Заметка").exists())

    def test_cannot_create_from_someone_elses_personal_template(self):
        template = DocumentTemplate.objects.create(
            title="Личный", content={"kind": "sheet"}, is_personal=True, is_active=True,
            created_by=self.owner,
        )
        self.assertDenied(self.client.get(f"/api/templates/{template.id}/"))
        response = self.client.post("/api/documents/", {"template_id": str(template.id)},
                                    format="json")
        self.assertIn(response.status_code, {400, 403, 404}, response.content)
        self.assertFalse(Document.objects.filter(owner=self.stranger).exists())

    def test_cannot_create_document_in_someone_elses_folder(self):
        folder = Folder.objects.create(name="Папка владельца", owner=self.owner)
        response = self.client.post("/api/documents/",
                                    {"title": "Подброс", "folder_id": str(folder.id)},
                                    format="json")
        self.assertFalse(Document.objects.filter(folder=folder, owner=self.stranger).exists(),
                         response.content)

    def test_folders(self):
        folder = Folder.objects.create(name="Папка владельца", owner=self.owner)
        self.assertDenied(self.client.patch(f"/api/folders/{folder.id}/", {"name": "x"},
                                            format="json"))
        self.assertDenied(self.client.delete(f"/api/folders/{folder.id}/"))
        response = self.client.post("/api/folders/", {"name": "Моя", "parent": str(folder.id)},
                                    format="json")
        self.assertFalse(Folder.objects.filter(parent=folder, owner=self.stranger).exists(),
                         response.content)

    def test_admin_endpoints_need_admin(self):
        self.assertDenied(self.client.get("/api/admin/users/"))
        self.assertDenied(self.client.get("/api/admin/summary/"))
        self.assertDenied(self.client.get("/api/accountant/summary/"))

    def test_anonymous_is_rejected(self):
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get("/api/documents/").status_code, 401)
        self.assertEqual(self.client.get(f"/api/documents/{self.document.id}/").status_code, 401)


class BadInputTests(APITestCase):
    """Кривой ввод — ошибка запроса (4xx), а не сбой сервера (500)."""

    def setUp(self):
        self.user = User.objects.create_user(email="user@example.com", password="pass-12345")
        self.client.force_authenticate(self.user)

    def test_folder_filter_with_bad_id(self):
        response = self.client.get("/api/documents/?folder=not-a-uuid")
        self.assertLess(response.status_code, 500, response.content)

    def test_search_with_nul_byte(self):
        self.client.post("/api/documents/", {"title": "Накладная 4501"}, format="json")
        for url in ("/api/documents/search/?q=45%0001", "/api/documents/?scope=search&q=%00"):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 200, (url, response.content))

    def test_template_from_document_with_bad_id(self):
        response = self.client.post("/api/templates/from-document/", {"document_id": "bad"},
                                    format="json")
        self.assertEqual(response.status_code, 404, response.content)


class QueryCountTests(APITestCase):
    """Число запросов к базе на списках не растёт вместе с числом строк."""

    def setUp(self):
        self.user = User.objects.create_user(email="user@example.com", password="pass-12345")
        self.client.force_authenticate(self.user)
        response = self.client.post("/api/documents/", {"title": "Журнал 0"}, format="json")
        self.document_id = response.data["id"]
        self.client.post(f"/api/documents/{self.document_id}/comments/", {"content": "к 0"},
                         format="json")

    def count(self, url):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        with CaptureQueriesContext(connection) as ctx:
            response = self.client.get(url)
        self.assertEqual(response.status_code, 200, (url, response.content))
        return len(ctx.captured_queries)

    def test_lists_do_not_grow_with_rows(self):
        urls = ["/api/documents/", "/api/documents/search/?q=Журнал",
                "/api/documents/?scope=search&q=Журнал",
                f"/api/documents/{self.document_id}/comments/", "/api/notifications/"]
        before = {url: self.count(url) for url in urls}
        for index in range(1, 10):
            self.client.post("/api/documents/", {"title": f"Журнал {index}"}, format="json")
            self.client.post(f"/api/documents/{self.document_id}/comments/",
                             {"content": f"к {index}"}, format="json")
        after = {url: self.count(url) for url in urls}
        self.assertEqual(before, after)
