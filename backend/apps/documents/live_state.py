"""Живое состояние редактора, присланное вместе с запросом."""
import base64
import binascii

from rest_framework.exceptions import ValidationError


def save_live_state(request, document) -> None:
    """Состояние, присланное открытым редактором, — в документ.

    Сервер получает свёрнутое состояние от вкладки раз в минуту, а правки
    между снимками лежат журналом приращений, который он сливать не умеет.
    Версия или публикация, сделанная «сейчас», выходила устаревшей на эту
    минуту: без последних правок. А восстановление такой версии стирало их
    насовсем. Поэтому редактор присылает своё текущее состояние вместе
    с запросом.
    Без него (старый клиент) — как раньше, по тому, что есть на сервере.
    """
    content = request.data.get("content")
    raw_state = request.data.get("state")
    if content is None or raw_state is None:
        return

    from apps.documents.serializers import DocumentUpdateSerializer
    from apps.documents.services import DocumentService

    DocumentUpdateSerializer().validate_content(content)
    try:
        state = base64.b64decode(raw_state, validate=True)
    except (ValueError, binascii.Error, TypeError) as error:
        raise ValidationError({"state": ["Состояние таблицы повреждено."]}) from error
    DocumentService().save_content(user=request.user, document=document, content=content,
                                   ydoc_state=state)
    document.refresh_from_db()
