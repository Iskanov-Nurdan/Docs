"""HTTP-слой документов: разбор запроса, проверка прав, вызов сервиса."""
import logging
import re
from decimal import Decimal, InvalidOperation

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Count
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import BusinessError, NotFoundError
from apps.core.permissions import IsAccountantOrAdmin
from apps.core.services import client_ip
from apps.documents.models import Document, DocumentActivity, Folder
from apps.documents.repositories import DocumentRepository, FolderRepository
from apps.documents.serializers import (
    DocumentCreateSerializer,
    DocumentDetailSerializer,
    DocumentListSerializer,
    DocumentUpdateSerializer,
    FolderSerializer,
    FolderWriteSerializer,
)
from apps.documents.services import DocumentService
from apps.permissions.models import Role
from apps.permissions.services import AccessService

logger = logging.getLogger(__name__)


class DocumentViewSet(viewsets.ViewSet):
    """Документы. Доступ к каждому проверяется через AccessService."""

    def _get_document(self, pk) -> Document:
        try:
            document = DocumentRepository().by_id(pk)
        except (DjangoValidationError, ValueError):
            # Адрес вида /api/documents/abc/ — не идентификатор. Это ошибка
            # запроса, а не сбой сервера, поэтому отвечаем «не найден».
            raise NotFoundError("Документ не найден.") from None

        if document is None:
            # Тот же ответ, что и при отсутствии прав: существование чужих
            # документов не должно определяться перебором адресов.
            raise NotFoundError("Документ не найден.")
        return document

    def _link_token(self, request) -> str | None:
        return request.query_params.get("link") or request.headers.get("X-Share-Link")

    def list(self, request):
        repository = DocumentRepository()
        scope = request.query_params.get("scope", "active")

        if scope == "trash":
            queryset = repository.trashed(request.user)
        elif scope == "starred":
            queryset = repository.starred(request.user)
        elif scope == "shared":
            queryset = repository.shared_with(request.user)
        elif scope == "search":
            queryset = repository.search(request.user, request.query_params.get("q", ""))
        else:
            queryset = repository.active(request.user)

        folder_id = request.query_params.get("folder")
        if folder_id:
            queryset = queryset.filter(folder_id=folder_id)

        ordering = request.query_params.get("ordering", "-last_edited_at")
        allowed = {
            "title", "-title",
            "created_at", "-created_at",
            "last_edited_at", "-last_edited_at",
        }
        if ordering in allowed:
            queryset = queryset.order_by(ordering)

        from apps.core.pagination import DefaultPagination

        paginator = DefaultPagination()
        page = paginator.paginate_queryset(queryset, request)
        # Без ролей карточка не знает, что человеку позволено, и прячет
        # переименование, перемещение и корзину даже у владельца.
        serializer = DocumentListSerializer(
            page, many=True,
            context={
                "request": request,
                "query": request.query_params.get("q", ""),
                "roles": AccessService().roles_for(user=request.user, documents=page),
            },
        )
        return paginator.get_paginated_response(serializer.data)

    def create(self, request):
        serializer = DocumentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        service = DocumentService()

        template_id = data.get("template_id")
        if template_id:
            from apps.doc_templates.models import DocumentTemplate

            template = DocumentTemplate.objects.filter(id=template_id, is_active=True).first()
            if template is None:
                raise BusinessError("Шаблон не найден.", code="template_not_found")
            document = service.create_from_template(user=request.user, template=template,
                                                     ip=client_ip(request))
        else:
            document = service.create(
                user=request.user,
                title=data.get("title", "Без названия"),
                folder_id=data.get("folder_id"),
                ip=client_ip(request),
            )

        return Response(
            DocumentDetailSerializer(document, context={"role": Role.OWNER}).data,
            status=status.HTTP_201_CREATED,
        )

    def retrieve(self, request, pk=None):
        document = self._get_document(pk)
        role = AccessService().require(
            user=request.user, document=document, minimum=Role.VIEWER,
            link_token=self._link_token(request),
        )
        DocumentService().log(document=document, user=request.user,
                              action=DocumentActivity.Action.OPENED, ip=client_ip(request))
        return Response(DocumentDetailSerializer(document, context={"role": role}).data)

    def partial_update(self, request, pk=None):
        document = self._get_document(pk)
        serializer = DocumentUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        document = DocumentService().update(
            user=request.user, document=document, data=serializer.validated_data,
            ip=client_ip(request),
        )
        # Роль — настоящая, а не OWNER: править документ может и редактор,
        # а получив в ответ «owner», интерфейс показывал ему «Поделиться»
        # и «Удалить» — кнопки, на которые сервер отвечает отказом.
        role = AccessService().role_for(user=request.user, document=document)
        return Response(DocumentDetailSerializer(document, context={"role": role}).data)

    def destroy(self, request, pk=None):
        document = self._get_document(pk)
        permanent = request.query_params.get("permanent") == "true"
        service = DocumentService()
        if permanent:
            service.delete_permanently(user=request.user, document=document)
        else:
            service.delete(user=request.user, document=document, ip=client_ip(request))
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def restore(self, request, pk=None):
        document = self._get_document(pk)
        document = DocumentService().restore(user=request.user, document=document,
                                             ip=client_ip(request))
        return Response(DocumentDetailSerializer(document, context={"role": Role.OWNER}).data)

    @action(detail=True, methods=["post"])
    def copy(self, request, pk=None):
        document = self._get_document(pk)
        copy = DocumentService().copy(user=request.user, document=document, ip=client_ip(request))
        return Response(
            DocumentDetailSerializer(copy, context={"role": Role.OWNER}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def star(self, request, pk=None):
        document = self._get_document(pk)
        is_starred = DocumentService().toggle_star(user=request.user, document=document)
        return Response({"is_starred": is_starred})

    @action(detail=True, methods=["get"])
    def activity(self, request, pk=None):
        document = self._get_document(pk)
        AccessService().require(user=request.user, document=document, minimum=Role.VIEWER,
                                link_token=self._link_token(request))
        rows = document.activities.select_related("user")[:100]
        return Response([
            {
                "id": row.id,
                "action": row.action,
                "action_display": row.get_action_display(),
                "user": row.user.display_name if row.user else None,
                "created_at": row.created_at,
                "metadata": row.metadata,
            }
            for row in rows
        ])


class FolderViewSet(viewsets.ViewSet):
    """Папки пользователя."""

    def list(self, request):
        folders = (
            FolderRepository()
            .for_user(request.user)
            .annotate(documents_count=Count("documents"))
        )
        return Response(FolderSerializer(folders, many=True).data)

    def create(self, request):
        serializer = FolderWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        parent = None
        if data.get("parent_id"):
            parent = FolderRepository().by_id(data["parent_id"], request.user)
            if parent is None:
                raise BusinessError("Родительская папка не найдена.", code="parent_not_found")

        folder = Folder.objects.create(name=data["name"], owner=request.user, parent=parent)
        return Response(FolderSerializer(folder).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        folder = FolderRepository().by_id(pk, request.user)
        if folder is None:
            raise NotFoundError("Папка не найдена.")

        serializer = FolderWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if "name" in data:
            folder.name = data["name"]
        if "parent_id" in data:
            parent = None
            if data["parent_id"]:
                parent = FolderRepository().by_id(data["parent_id"], request.user)
                if parent is None:
                    raise BusinessError("Родительская папка не найдена.", code="parent_not_found")
                # Папку нельзя вложить в собственную ветку: получилось бы
                # кольцо, и обход дерева зациклился бы.
                if parent.id == folder.id or parent in FolderRepository().descendants(folder):
                    raise BusinessError("Папку нельзя переместить внутрь самой себя.",
                                         code="folder_cycle")
            folder.parent = parent
        folder.save()
        return Response(FolderSerializer(folder).data)

    def destroy(self, request, pk=None):
        folder = FolderRepository().by_id(pk, request.user)
        if folder is None:
            raise NotFoundError("Папка не найдена.")
        # Документы не удаляются вместе с папкой: они переходят в корень,
        # иначе одно нажатие уносило бы в корзину десятки файлов.
        folder.documents.update(folder=None)
        folder.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class DocumentSearchView(APIView):
    """Глобальный поиск по названию и содержимому."""

    def get(self, request):
        query = request.query_params.get("q", "")
        documents = list(DocumentRepository().search(request.user, query)[:50])
        return Response(
            DocumentListSerializer(
                documents, many=True,
                context={
                    "query": query,
                    "roles": AccessService().roles_for(user=request.user, documents=documents),
                },
            ).data
        )


def _column_number(letters: str) -> int:
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - ord("A") + 1
    return value - 1


def _amount(value) -> Decimal:
    """Разбирает введённые суммы и форматированные снимки таблицы."""
    text = str(value or "").replace(" ", "").replace("\u00a0", "")
    text = re.sub(r"[^0-9,.-]", "", text).replace(",", ".")
    try:
        return Decimal(text) if text and text not in ("-", ".") else Decimal(0)
    except InvalidOperation:
        return Decimal(0)


def _cargo_rows(document: Document) -> list[dict]:
    content = document.content if isinstance(document.content, dict) else {}
    result = []
    for sheet in content.get("sheets") or []:
        cells = sheet.get("cells") if isinstance(sheet, dict) else None
        if not isinstance(cells, dict):
            continue
        matrix: dict[int, dict[int, str]] = {}
        for address, cell in cells.items():
            match = re.fullmatch(r"([A-Z]+)([1-9][0-9]*)", str(address))
            if not match or not isinstance(cell, dict):
                continue
            row_num = int(match.group(2)) - 1
            col_num = _column_number(match.group(1))
            matrix.setdefault(row_num, {})[col_num] = str(cell.get("display") or cell.get("value") or "").strip()

        headers = matrix.get(0, {})
        if not headers:
            continue
        labels = {col: label.casefold() for col, label in headers.items()}

        def find_column(*words):
            return next((col for col, label in labels.items() if any(word in label for word in words)), None)

        def find_in_order(*words):
            """Колонка по первому подошедшему слову: «общий расход» важнее просто «расхода»."""
            for word in words:
                col = next((col for col, label in labels.items() if word in label), None)
                if col is not None:
                    return col
            return None

        status_col = find_column("статус", "status")
        # «ТИП Перегрузка» содержит «груз», но грузом не называется.
        cargo_col = next(
            (col for col, label in labels.items()
             if "перегруз" not in label
             and any(word in label for word in ("груз", "товар", "cargo", "product", "маш", "авто", "рейс"))),
            None,
        )
        transit_col = find_column("транзит", "transit", "tranzit", "жол кире")
        tax_col = find_column("налог", "tax", "пошлин", "%")
        # «TRANZIT 04%» — транзит, а не налог, хотя в заголовке есть «%».
        if tax_col is not None and tax_col == transit_col:
            tax_col = find_column("налог", "tax", "пошлин")
        income_col = find_column("стоимость", "доход", "выручк")
        expense_col = find_in_order("общий расход", "общие расход", "итого расход", "расход")
        profit_col = find_column("прибыл", "profit")
        loss_col = find_column("ущерб", "убыт")
        from_col = find_column("откуда", "from")
        to_col = find_column("куда", "destination", "to")
        sheet_name = str(sheet.get("name") or "Лист")
        sheet_label = sheet_name.casefold()

        def money(col, values) -> Decimal:
            return _amount(values.get(col, "")) if col is not None else Decimal(0)

        for row_num, values in matrix.items():
            if row_num == 0 or not any(values.values()):
                continue
            status = values.get(status_col, "").casefold() if status_col is not None else ""
            delivered = any(word in sheet_label for word in ("достав", "прибыл", "delivered", "arrived")) or any(
                word in status for word in ("достав", "прибыл", "готово", "delivered", "arrived")
            )
            in_transit = any(word in sheet_label for word in ("в пути", "рейс", "груз", "transit")) or any(
                word in status for word in ("в пути", "отправ", "транзит", "in transit")
            )
            amounts = {
                "tax": money(tax_col, values),
                "transit": money(transit_col, values),
                "income": money(income_col, values),
                "expense": money(expense_col, values),
                "profit": money(profit_col, values),
                "loss": money(loss_col, values),
            }
            # Строка без статуса не теряется, если в ней есть деньги: так
            # считаются таблицы, где статус не ведут (учёт по машинам).
            if not delivered and not in_transit and not any(amounts.values()):
                continue
            cargo = values.get(cargo_col, "") if cargo_col is not None else f"Груз · строка {row_num + 1}"
            if not cargo or cargo.casefold() in ("итого", "всего", "total"):
                continue
            result.append({
                "document_id": str(document.id),
                "document_title": document.title,
                "sheet": sheet_name,
                "status": "delivered" if delivered else "in_transit" if in_transit else "other",
                "cargo": cargo,
                "route": " → ".join(part for part in (
                    values.get(from_col, "") if from_col is not None else "",
                    values.get(to_col, "") if to_col is not None else "",
                ) if part),
                **{key: str(value) for key, value in amounts.items()},
            })
    return result


class AccountantSummaryView(APIView):
    """Строки грузовых журналов и суммы для рабочего стола бухгалтера."""

    permission_classes = (IsAccountantOrAdmin,)

    def get(self, request):
        documents = list(
            Document.objects.filter(deleted_at__isnull=True)
            .only("id", "title", "content")
            .order_by("-created_at")
        )
        rows = [row for document in documents for row in _cargo_rows(document)]
        keys = ("tax", "transit", "income", "expense", "profit", "loss")
        totals = {
            status: {"count": 0, **{key: Decimal(0) for key in keys}}
            for status in ("in_transit", "delivered", "other")
        }
        for row in rows:
            group = totals[row["status"]]
            group["count"] += 1
            for key in keys:
                group[key] += Decimal(row[key])
        return Response({
            # Все таблицы, а не только те, где нашлись грузы: бухгалтер выбирает
            # из полного списка, а у таблицы без грузовых колонок просто пусто.
            "documents": [{"id": str(document.id), "title": document.title} for document in documents],
            "rows": rows,
            "totals": {
                status: {"count": value["count"], **{key: str(value[key]) for key in keys}}
                for status, value in totals.items()
            },
        })
