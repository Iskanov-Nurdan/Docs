"""Мелкие утилиты предметного слоя."""
import html

import bleach

# Названия документов, имена папок и прочие строки приходят от людей:
# разметку из них вырезаем, чтобы ввод не стал HTML на странице.
ALLOWED_TAGS: list[str] = []


def plain_text(value: str) -> str:
    """Убирает разметку: пользовательский ввод не должен становиться HTML.

    Теги вырезаются, а сущности возвращаются в обычные символы: bleach
    превращал «Рейсы <Ош> & Кашгар» в «Рейсы &lt;Ош&gt; &amp; Кашгар», и
    люди видели эти «&lt;» в названии. Хранится обычный текст — экранирует
    его то место, где он выводится (React, html.escape в выгрузке, шаблоны).
    """
    return html.unescape(bleach.clean(value or "", tags=ALLOWED_TAGS, strip=True)).strip()


def client_ip(request) -> str | None:
    """Реальный адрес клиента за обратным прокси."""
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR")
