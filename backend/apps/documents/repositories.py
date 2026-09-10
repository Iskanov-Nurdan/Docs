"""Запросы к документам и папкам."""
from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import Exists, OuterRef, Q, QuerySet

from apps.documents.models import Document, Folder, StarredDocument


class DocumentRepository:
    def base_queryset(self) -> QuerySet[Document]:
        return Document.objects.select_related("owner", "folder", "last_edited_by")

    def visible_to(self, user) -> QuerySet[Document]:
        """Свои документы и те, к которым выдан доступ."""
        starred = StarredDocument.objects.filter(user=user, document=OuterRef("pk"))
        return (
            self.base_queryset()
            .filter(Q(owner=user) | Q(permissions__user=user))
            .annotate(is_starred=Exists(starred))
            .distinct()
        )

    def active(self, user) -> QuerySet[Document]:
        return self.visible_to(user).filter(deleted_at__isnull=True)

    def trashed(self, user) -> QuerySet[Document]:
        """В корзине человек видит только то, что удалил сам."""
        return self.visible_to(user).filter(deleted_at__isnull=False, owner=user)

    def starred(self, user) -> QuerySet[Document]:
        return self.active(user).filter(starred_by__user=user)

    def by_id(self, document_id) -> Document | None:
        return self.base_queryset().filter(id=document_id).first()

    def search(self, user, query: str) -> QuerySet[Document]:
        """Полнотекстовый поиск по названию и содержимому.

        Ищем через search_vector: он обновляется при сохранении документа,
        поэтому запрос не разбирает JSON содержимого на каждый ввод символа.
        """
        query = (query or "").strip()
        documents = self.active(user)
        if not query:
            return documents

        search_query = SearchQuery(query, config="russian")
        return (
            documents.filter(Q(search_vector=search_query) | Q(title__icontains=query))
            .annotate(rank=SearchRank("search_vector", search_query))
            .order_by("-rank", "-last_edited_at")
        )


class FolderRepository:
    def for_user(self, user) -> QuerySet[Folder]:
        return Folder.objects.filter(owner=user, deleted_at__isnull=True).select_related("parent")

    def by_id(self, folder_id, user) -> Folder | None:
        return self.for_user(user).filter(id=folder_id).first()

    def descendants(self, folder: Folder) -> list[Folder]:
        """Все вложенные папки: нужно при удалении и перемещении ветки."""
        result: list[Folder] = []
        queue = [folder]
        while queue:
            current = queue.pop()
            children = list(current.children.filter(deleted_at__isnull=True))
            result.extend(children)
            queue.extend(children)
        return result
