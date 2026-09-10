"""Бизнес-логика документов."""
import logging

from django.contrib.postgres.search import SearchVector
from django.db import transaction
from django.utils import timezone

from apps.core.exceptions import BusinessError, NotFoundError
from apps.core.services import plain_text
from apps.documents.models import Document, DocumentActivity, Folder, StarredDocument
from apps.documents.repositories import DocumentRepository, FolderRepository
from apps.documents.text import extract_plain_text
from apps.permissions.models import Role
from apps.permissions.services import AccessService

logger = logging.getLogger(__name__)

EMPTY_DOCUMENT = {"type": "doc", "content": [{"type": "paragraph"}]}


class DocumentService:
    def __init__(self):
        self.repository = DocumentRepository()
        self.folders = FolderRepository()
        self.access = AccessService()

    # ------------------------------- Создание -------------------------------

    @transaction.atomic
    def create(self, *, user, title: str = "Без названия", content: dict | None = None,
               folder_id=None, ip: str | None = None) -> Document:
        folder = self._folder_or_none(folder_id, user)
        document = Document.objects.create(
            title=plain_text(title) or "Без названия",
            owner=user,
            folder=folder,
            content=content or EMPTY_DOCUMENT,
            last_edited_by=user,
            last_edited_at=timezone.now(),
        )
        self._reindex(document)
        self.log(document=document, user=user, action=DocumentActivity.Action.CREATED, ip=ip)
        logger.info("Создан документ %s пользователем %s", document.id, user.email)
        return document

    @transaction.atomic
    def create_from_template(self, *, user, template, ip: str | None = None) -> Document:
        return self.create(user=user, title=template.title, content=template.content, ip=ip)

    @transaction.atomic
    def copy(self, *, user, document: Document, ip: str | None = None) -> Document:
        role = self.access.require(user=user, document=document, minimum=Role.VIEWER)
        if not self.access.can_copy(user=user, document=document, role=role):
            raise BusinessError("Владелец запретил копирование документа.", code="copy_denied")

        # Комментарии, история и права не переносятся: копия — независимый
        # документ, а чужие обсуждения в ней были бы утечкой контекста.
        copy = Document.objects.create(
            title=f"Копия {document.title}"[:255],
            owner=user,
            content=document.content,
            document_mode=document.document_mode,
            page_size=document.page_size,
            orientation=document.orientation,
            margin_top=document.margin_top,
            margin_bottom=document.margin_bottom,
            margin_left=document.margin_left,
            margin_right=document.margin_right,
            page_color=document.page_color,
            last_edited_by=user,
            last_edited_at=timezone.now(),
        )
        self._reindex(copy)
        self.log(document=document, user=user, action=DocumentActivity.Action.COPIED, ip=ip,
                 metadata={"copy_id": str(copy.id)})
        return copy

    # ------------------------------ Изменение ------------------------------

    @transaction.atomic
    def update(self, *, user, document: Document, data: dict, ip: str | None = None) -> Document:
        self.access.require(user=user, document=document, minimum=Role.EDITOR)

        renamed = "title" in data and data["title"] != document.title
        moved = "folder_id" in data

        for field, value in data.items():
            if field == "folder_id":
                document.folder = self._folder_or_none(value, user)
            elif field == "title":
                document.title = plain_text(value) or "Без названия"
            else:
                setattr(document, field, value)

        document.last_edited_by = user
        document.last_edited_at = timezone.now()
        document.save()

        if "content" in data:
            self._reindex(document)

        if renamed:
            self.log(document=document, user=user, action=DocumentActivity.Action.RENAMED, ip=ip,
                     metadata={"title": document.title})
        if moved:
            self.log(document=document, user=user, action=DocumentActivity.Action.MOVED, ip=ip)
        return document

    @transaction.atomic
    def save_content(self, *, user, document: Document, content: dict,
                     ydoc_state: bytes | None = None) -> Document:
        """Сохранение содержимого из редактора.

        Вызывается автосохранением и потребителем WebSocket. Права проверяются
        и здесь: WebSocket — такой же вход в систему, как REST.
        """
        self.access.require(user=user, document=document, minimum=Role.EDITOR)

        document.content = content
        if ydoc_state is not None:
            document.ydoc_state = ydoc_state
        document.last_edited_by = user
        document.last_edited_at = timezone.now()
        document.save(update_fields=[
            "content", "ydoc_state", "last_edited_by", "last_edited_at", "updated_at",
        ])
        self._reindex(document)
        return document

    # ------------------------- Корзина и восстановление -------------------------

    @transaction.atomic
    def delete(self, *, user, document: Document, ip: str | None = None) -> Document:
        self.access.require(user=user, document=document, minimum=Role.OWNER)
        document.deleted_at = timezone.now()
        document.save(update_fields=["deleted_at", "updated_at"])
        self.log(document=document, user=user, action=DocumentActivity.Action.DELETED, ip=ip)
        logger.info("Документ %s перемещён в корзину", document.id)
        return document

    @transaction.atomic
    def restore(self, *, user, document: Document, ip: str | None = None) -> Document:
        if document.owner_id != user.id:
            raise NotFoundError("Документ не найден.")
        if document.deleted_at is None:
            raise BusinessError("Документ не находится в корзине.", code="not_deleted")

        document.deleted_at = None
        document.save(update_fields=["deleted_at", "updated_at"])
        self.log(document=document, user=user, action=DocumentActivity.Action.RESTORED, ip=ip)
        return document

    @transaction.atomic
    def delete_permanently(self, *, user, document: Document) -> None:
        if document.owner_id != user.id:
            raise NotFoundError("Документ не найден.")
        if document.deleted_at is None:
            raise BusinessError("Сначала переместите документ в корзину.", code="not_deleted")
        logger.info("Документ %s удалён безвозвратно", document.id)
        document.delete()

    # -------------------------------- Прочее --------------------------------

    def toggle_star(self, *, user, document: Document) -> bool:
        """Возвращает новое состояние: True — в избранном."""
        self.access.require(user=user, document=document, minimum=Role.VIEWER)
        existing = StarredDocument.objects.filter(user=user, document=document).first()
        if existing:
            existing.delete()
            return False
        StarredDocument.objects.create(user=user, document=document)
        return True

    def log(self, *, document: Document, user, action: str, ip: str | None = None,
            metadata: dict | None = None) -> None:
        DocumentActivity.objects.create(
            document=document,
            user=user if user and user.is_authenticated else None,
            action=action,
            metadata=metadata or {},
            ip_address=ip,
        )

    def _folder_or_none(self, folder_id, user) -> Folder | None:
        if not folder_id:
            return None
        folder = self.folders.by_id(folder_id, user)
        if folder is None:
            raise BusinessError("Папка не найдена.", code="folder_not_found")
        return folder

    def _reindex(self, document: Document) -> None:
        """Обновляет текст и поисковый вектор.

        Поиск не разбирает JSON на лету: за это платили бы каждым запросом
        списка документов.
        """
        document.plain_text = extract_plain_text(document.content)
        Document.objects.filter(pk=document.pk).update(plain_text=document.plain_text)
        Document.objects.filter(pk=document.pk).update(
            search_vector=SearchVector("title", weight="A", config="russian")
            + SearchVector("plain_text", weight="B", config="russian")
        )
