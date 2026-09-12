"""Шаблоны документов и готовые блоки.

Приложение названо doc_templates, а не templates: последнее совпало бы
с каталогом шаблонов Django и путало бы импорты.
"""
from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class TemplateCategory(models.TextChoices):
    BLANK = "blank", "Пустой документ"
    RESUME = "resume", "Резюме"
    LETTER = "letter", "Письмо"
    REPORT = "report", "Отчёт"
    PROJECT = "project", "Проект"
    STUDY = "study", "Учебная работа"
    NOTES = "notes", "Заметки"
    BUSINESS = "business", "Деловой документ"


class DocumentTemplate(UUIDModel, TimeStampedModel):
    title = models.CharField("Название", max_length=150)
    description = models.CharField("Описание", max_length=300, blank=True)
    category = models.CharField("Категория", max_length=20, choices=TemplateCategory.choices,
                                default=TemplateCategory.BLANK, db_index=True)
    content = models.JSONField("Содержимое", default=dict)
    preview_image = models.ImageField("Обложка", upload_to="templates/", null=True, blank=True)

    # Готовые блоки (план проекта, заметки о встрече) вставляются внутрь
    # документа, а не создают новый.
    is_building_block = models.BooleanField("Готовый блок", default=False, db_index=True)
    is_active = models.BooleanField("Показывать", default=True, db_index=True)

    # Личный шаблон виден только автору. Своя заготовка — дело внутреннее:
    # у одного это журнал рейсов со своими колонками, у другого счета, и
    # общая галерея от таких заготовок быстро превратилась бы в свалку.
    is_personal = models.BooleanField("Личный", default=False, db_index=True)
    order = models.PositiveIntegerField("Порядок", default=100)
    created_by = models.ForeignKey("users.User", verbose_name="Автор", on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name="templates")

    class Meta:
        db_table = "document_templates"
        verbose_name = "Шаблон"
        verbose_name_plural = "Шаблоны"
        ordering = ("order", "title")
        indexes = [models.Index(fields=["category", "is_active"])]

    def __str__(self):
        return self.title
