"""WebSocket документа: совместное редактирование, курсоры, присутствие.

Сервер здесь — не редактор, а точка обмена. Он рассылает двоичные приращения
Yjs остальным участникам и складывает их в журнал. Разбирать содержимое
приращения ему не нужно: сходимость обеспечивает сам CRDT.

Правки не применяются подменой всего содержимого через REST — иначе двое,
печатающих в один абзац, затирали бы работу друг друга.
"""
import base64
import binascii
import json
import logging

from asgiref.sync import sync_to_async
from channels.generic.websocket import AsyncWebsocketConsumer
from django.conf import settings
from django.utils import timezone

from apps.documents.models import Document, DocumentUpdate
from apps.permissions.models import ROLE_RANK, Role
from apps.permissions.services import AccessService

logger = logging.getLogger(__name__)

# Приращение больше этого размера — почти наверняка не правка человека,
# а попытка забить память сервера.
MAX_UPDATE_BYTES = 1024 * 1024


# Сколько секунд после подключения пустой снимок считается недоразумением,
# а не осознанной очисткой. Клиент за это время успевает получить состояние
# с сервера и, если надо, засеять книгу из содержимого базы.
EMPTY_SNAPSHOT_GRACE_SECONDS = 15


def _cell_count(content) -> int:
    """Сколько заполненных ячеек в книге. Чужой формат считается пустым.

    Считаются именно заполненные. Прежняя версия брала len(cells), и снимок
    с одной пустой ячейкой обходил защиту, затирая книгу целиком.
    """
    if not isinstance(content, dict):
        return 0

    total = 0
    for sheet in content.get("sheets") or []:
        if not isinstance(sheet, dict):
            continue
        cells = sheet.get("cells")
        if not isinstance(cells, dict):
            continue
        for cell in cells.values():
            if isinstance(cell, dict):
                filled = cell.get("value") not in (None, "") or cell.get("display") not in (None, "")
            else:
                filled = cell not in (None, "")
            if filled:
                total += 1
    return total


class DocumentConsumer(AsyncWebsocketConsumer):
    """Одно соединение — один участник одного документа."""

    async def connect(self):
        self.document_id = self.scope["url_route"]["kwargs"]["document_id"]
        self.user = self.scope.get("user")
        self.group_name = f"document.{self.document_id}"
        self.role: Role | None = None

        if not self.user or not self.user.is_authenticated:
            # 4401 — своё значение: клиент отличает «нет доступа»
            # от обрыва сети и не пытается переподключаться вечно.
            await self.close(code=4401)
            return

        document = await self._load_document()
        if document is None:
            await self.close(code=4404)
            return

        self.role = await self._resolve_role(document)
        if self.role is None:
            await self.close(code=4403)
            return

        self.document = document
        self.connected_at = timezone.now()
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Новому участнику — накопленное состояние документа, иначе он увидит
        # пустой лист вместо текста.
        state, updates = await self._load_state()
        await self.send(text_data=json.dumps({
            "type": "sync_init",
            "role": self.role,
            "has_state": state is not None,
            "updates_count": len(updates),
        }))
        if state:
            await self.send(bytes_data=state)
        for payload in updates:
            await self.send(bytes_data=payload)

        await self._broadcast_presence("user_join")
        logger.info("Пользователь %s открыл документ %s (%s)",
                    self.user.email, self.document_id, self.role)

    async def disconnect(self, code):
        if getattr(self, "role", None) is None:
            return
        await self._broadcast_presence("user_leave")
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    # ------------------------------- Приём -------------------------------

    async def receive(self, text_data=None, bytes_data=None):
        if bytes_data is not None:
            await self._handle_update(bytes_data)
            return
        if text_data is None:
            return

        # Размер проверяется до разбора: json.loads разворачивает кадр целиком,
        # и двухсотмегабайтный снимок съедал память ещё до первой проверки.
        # У nginx client_max_body_size на кадры WebSocket не распространяется.
        if len(text_data) > settings.MAX_DOCUMENT_BYTES:
            logger.warning(
                "Сообщение документа %s на %s байт отброшено: предел %s",
                self.document_id, len(text_data), settings.MAX_DOCUMENT_BYTES,
            )
            return

        try:
            message = json.loads(text_data)
        except json.JSONDecodeError:
            return

        handlers = {
            "cursor_update": self._handle_cursor,
            "selection_update": self._handle_cursor,
            "presence_update": self._handle_cursor,
            "snapshot": self._handle_snapshot,
        }
        handler = handlers.get(message.get("type"))
        if handler:
            await handler(message)

    async def _handle_update(self, payload: bytes):
        """Двоичное приращение Yjs."""
        if not self._can_edit():
            return
        if len(payload) > MAX_UPDATE_BYTES:
            logger.warning("Слишком большое приращение документа %s отброшено", self.document_id)
            return

        await self._store_update(payload)
        # Отправителю приращение не возвращается: у него оно уже применено.
        await self.channel_layer.group_send(self.group_name, {
            "type": "document.update",
            "payload": payload,
            "sender": self.channel_name,
        })

    async def _handle_cursor(self, message: dict):
        """Положение курсора и выделения. В базу не пишется — это данные момента."""
        await self.channel_layer.group_send(self.group_name, {
            "type": "cursor.update",
            "sender": self.channel_name,
            "data": {
                "type": message.get("type", "cursor_update"),
                "user": self._user_payload(),
                "cursor": message.get("cursor"),
                "selection": message.get("selection"),
            },
        })

    async def _handle_snapshot(self, message: dict):
        """Свёрнутое состояние от клиента.

        Сервер не умеет сливать приращения сам, поэтому участник, у которого
        документ открыт, время от времени присылает состояние целиком: и дерево
        узлов для поиска с экспортом, и двоичное состояние Yjs для тех, кто
        подключится следующим.

        Журнал очищается только когда пришло и то, и другое. Иначе приращения
        были бы удалены, а состояние осталось прежним — и следующий участник
        открыл бы документ без последних правок.
        """
        if not self._can_edit():
            return

        from rest_framework.exceptions import ValidationError

        from apps.documents.serializers import DocumentUpdateSerializer

        content = message.get("content")
        raw_state = message.get("state")
        if not isinstance(content, dict) or not isinstance(raw_state, str):
            logger.warning("Неполный снимок документа %s отклонён", self.document_id)
            return

        # Тот же разбор, что и у REST. Раньше снимок не проверялся вовсе, и
        # книга неверной формы доезжала до переиндексации, роняя соединение.
        try:
            DocumentUpdateSerializer().validate_content(content)
        except ValidationError as error:
            logger.warning("Снимок документа %s не прошёл проверку: %s",
                           self.document_id, error.detail)
            return

        try:
            state = base64.b64decode(raw_state, validate=True)
        except (ValueError, binascii.Error):
            logger.warning("Снимок документа %s не удалось разобрать", self.document_id)
            return

        await self._save_snapshot(content, state)

    # ------------------------- Рассылка группе -------------------------

    async def document_update(self, event):
        if event["sender"] == self.channel_name:
            return
        await self.send(bytes_data=event["payload"])

    async def cursor_update(self, event):
        if event["sender"] == self.channel_name:
            return
        await self.send(text_data=json.dumps(event["data"]))

    async def presence_event(self, event):
        if event["sender"] == self.channel_name:
            return
        await self.send(text_data=json.dumps(event["data"]))

    async def comment_event(self, event):
        """Комментарии и предложения приходят из REST-слоя через channel layer."""
        await self.send(text_data=json.dumps(event["data"]))

    # ------------------------------ Служебное ------------------------------

    def _can_edit(self) -> bool:
        return self.role is not None and ROLE_RANK[self.role] >= ROLE_RANK[Role.EDITOR]

    def _user_payload(self) -> dict:
        return {
            "id": str(self.user.id),
            "name": self.user.display_name,
            "initials": self.user.initials,
            "color": self.user.cursor_color or "#2563eb",
            "avatar": self.user.avatar.url if self.user.avatar else None,
        }

    async def _broadcast_presence(self, event_type: str):
        await self.channel_layer.group_send(self.group_name, {
            "type": "presence.event",
            "sender": self.channel_name,
            "data": {"type": event_type, "user": self._user_payload()},
        })

    @sync_to_async
    def _load_document(self) -> Document | None:
        return Document.objects.filter(id=self.document_id, deleted_at__isnull=True).first()

    @sync_to_async
    def _resolve_role(self, document: Document) -> Role | None:
        # Токен ссылки приходит тем же параметром запроса, что и JWT.
        from urllib.parse import parse_qs

        query = parse_qs(self.scope.get("query_string", b"").decode())
        link_token = (query.get("link") or [None])[0]
        return AccessService().role_for(user=self.user, document=document, link_token=link_token)

    @sync_to_async
    def _load_state(self) -> tuple[bytes | None, list[bytes]]:
        document = Document.objects.filter(id=self.document_id).only("ydoc_state").first()
        state = bytes(document.ydoc_state) if document and document.ydoc_state else None
        updates = [
            bytes(row.payload)
            for row in DocumentUpdate.objects.filter(document_id=self.document_id).order_by("created_at", "id")
        ]
        return state, updates

    @sync_to_async
    def _store_update(self, payload: bytes) -> None:
        DocumentUpdate.objects.create(
            document_id=self.document_id, payload=payload, author=self.user
        )
        Document.objects.filter(id=self.document_id).update(
            last_edited_by=self.user, last_edited_at=timezone.now()
        )

    @sync_to_async
    def _save_snapshot(self, content: dict, state: bytes) -> None:
        from django.db import transaction

        from apps.documents.services import DocumentService

        document = Document.objects.filter(id=self.document_id).first()
        if document is None:
            return

        # Пустой снимок поверх заполненной книги — почти всегда признак того,
        # что клиент не успел получить содержимое и прислал то, что есть у него.
        # Так документ, созданный из шаблона, терял всё содержимое сразу после
        # открытия.
        #
        # Но «не первым же снимком» надо было ещё и проверять: прежнее условие
        # не смотрело ни на время, ни на номер снимка и отклоняло очистку
        # всегда, так что таблицу нельзя было очистить в принципе. Считаем
        # подозрительными только первые секунды соединения.
        if _cell_count(content) == 0 and _cell_count(document.content) > 0:
            age = (timezone.now() - self.connected_at).total_seconds()
            if age < EMPTY_SNAPSHOT_GRACE_SECONDS:
                logger.warning(
                    "Пустой снимок документа %s отклонён: соединению %.1f с, в базе %s ячеек",
                    self.document_id, age, _cell_count(document.content),
                )
                return
            logger.info("Документ %s очищен пользователем %s",
                        self.document_id, self.user.email)

        # Момент, на который построен снимок. Читается до записи: save_content
        # меняет last_edited_at у этого же объекта, и прежний код сравнивал
        # приращения с временем уже после сохранения — то есть удалял и те
        # правки соседа, которые пришли, пока снимок ехал по сети.
        built_before = document.last_edited_at

        # Снимок и очистка журнала — одной транзакцией: сбой посередине
        # оставил бы документ без части правок.
        with transaction.atomic():
            DocumentService().save_content(
                user=self.user, document=document, content=content, ydoc_state=state
            )
            # Приращения, пришедшие уже после снимка, обязаны уцелеть.
            DocumentUpdate.objects.filter(
                document_id=self.document_id, created_at__lte=built_before
            ).delete()
