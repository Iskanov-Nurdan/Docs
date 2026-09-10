"""Приём файлов.

Проверяется и заявленный тип, и настоящий: расширение и заголовок Content-Type
задаёт клиент, поэтому доверять им нельзя. Картинку читаем Pillow — если она
не открывается, это не картинка, чем бы её ни назвали.
"""
import logging

from django.conf import settings
from PIL import Image, UnidentifiedImageError

from apps.core.exceptions import BusinessError
from apps.files.models import StoredFile

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"}
ALLOWED_IMPORT_TYPES = {
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "text/plain",
    "text/html",
    "application/rtf",
    "application/vnd.oasis.opendocument.text",  # odt
}

# Картинка больше этого размера разворачивается в памяти в сотни мегабайт —
# классический способ уронить сервер одним файлом.
MAX_IMAGE_PIXELS = 50_000_000


class FileService:
    def upload_image(self, *, user, upload, document=None) -> StoredFile:
        self._check_size(upload)

        if upload.content_type not in ALLOWED_IMAGE_TYPES:
            raise BusinessError(
                "Поддерживаются JPEG, PNG, GIF, WebP и SVG.", code="unsupported_type"
            )

        width = height = None
        # SVG — это текст, Pillow его не открывает; остальное проверяем разбором.
        if upload.content_type != "image/svg+xml":
            width, height = self._probe_image(upload)

        stored = StoredFile.objects.create(
            kind=StoredFile.Kind.IMAGE,
            file=upload,
            original_name=upload.name[:255],
            content_type=upload.content_type,
            size=upload.size,
            width=width,
            height=height,
            document=document,
            uploaded_by=user,
        )
        logger.info("Загружено изображение %s (%s байт)", stored.id, stored.size)
        return stored

    def upload_import(self, *, user, upload) -> StoredFile:
        self._check_size(upload)
        if upload.content_type not in ALLOWED_IMPORT_TYPES:
            raise BusinessError(
                "Поддерживаются DOCX, TXT, HTML, RTF и ODT.", code="unsupported_type"
            )
        return StoredFile.objects.create(
            kind=StoredFile.Kind.IMPORT,
            file=upload,
            original_name=upload.name[:255],
            content_type=upload.content_type,
            size=upload.size,
            uploaded_by=user,
        )

    def _check_size(self, upload) -> None:
        limit = settings.MAX_UPLOAD_BYTES
        if upload.size > limit:
            raise BusinessError(
                f"Файл больше допустимых {limit // (1024 * 1024)} МБ.", code="file_too_large"
            )

    def _probe_image(self, upload) -> tuple[int, int]:
        try:
            image = Image.open(upload)
            image.verify()
            width, height = image.size
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise BusinessError("Файл не является изображением.", code="broken_image") from exc
        finally:
            # verify() оставляет файл прочитанным до конца: без перемотки
            # в хранилище уйдёт пустышка.
            upload.seek(0)

        if width * height > MAX_IMAGE_PIXELS:
            raise BusinessError("Изображение слишком большое.", code="image_too_large")
        return width, height
