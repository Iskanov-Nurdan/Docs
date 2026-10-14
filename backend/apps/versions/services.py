"""История версий: снимки и восстановление."""
import logging

from django.db import transaction
from django.db.models import Max

from apps.core.exceptions import BusinessError
from apps.permissions.models import Role
from apps.permissions.services import AccessService
from apps.versions.models import DocumentVersion

logger = logging.getLogger(__name__)


class VersionService:
    def __init__(self):
        self.access = AccessService()

    @transaction.atomic
    def create_snapshot(self, *, document, user=None, label: str = "",
                        metadata: dict | None = None) -> DocumentVersion:
        """Снимок текущего состояния документа."""
        last_number = (
            DocumentVersion.objects.filter(document=document)
            .aggregate(Max("version_number"))["version_number__max"] or 0
        )
        version = DocumentVersion.objects.create(
            document=document,
            user=user or document.last_edited_by,
            version_number=last_number + 1,
            content=document.content,
            ydoc_state=document.ydoc_state,
            label=label,
            metadata=metadata or {},
        )
        logger.info("Документ %s: сохранена версия %s", document.id, version.version_number)
        return version

    @transaction.atomic
    def restore(self, *, user, document, version: DocumentVersion) -> DocumentVersion:
        """Восстановление старой версии.

        Прежние версии не удаляются: содержимое выбранной версии ложится
        поверх истории новой записью. Иначе «откатился и передумал» стоил бы
        пользователю всей последующей работы.
        """
        self.access.require(user=user, document=document, minimum=Role.EDITOR)

        if version.document_id != document.id:
            raise BusinessError("Версия принадлежит другому документу.", code="wrong_document")

        # Текущее состояние тоже уходит в историю — иначе оно потерялось бы
        # безвозвратно при восстановлении.
        self.create_snapshot(
            document=document,
            user=user,
            label="Перед восстановлением",
            metadata={"reason": "before_restore", "restored_version": version.version_number},
        )

        # Само содержимое сервер не подменяет. Раньше здесь записывалось старое
        # состояние Yjs, но у открытых вкладок (и в их IndexedDB) лежало более
        # новое: при синхронизации CRDT складывал их, новое побеждало, и
        # восстановление молча отменялось. Теперь версию переписывает поверх
        # таблицы редактор — обычной правкой, которая расходится всем
        # участникам и отменяется Ctrl+Z (SpreadsheetEditor, replaceBook).
        logger.info("Документ %s восстанавливается до версии %s пользователем %s",
                    document.id, version.version_number, user.email)
        return version
