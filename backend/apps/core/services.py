"""Мелкие утилиты предметного слоя."""
import bleach

# Текст документа хранится структурой ProseMirror, а не HTML, но заголовки,
# имена папок и комментарии приходят строками — их чистим от разметки.
ALLOWED_TAGS: list[str] = []


def plain_text(value: str) -> str:
    """Убирает разметку: пользовательский ввод не должен становиться HTML."""
    return bleach.clean(value or "", tags=ALLOWED_TAGS, strip=True).strip()


def client_ip(request) -> str | None:
    """Реальный адрес клиента за обратным прокси."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
