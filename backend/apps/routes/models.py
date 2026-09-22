"""Справочник точек и нормативов времени между ними.

Журнал рейсов ведут одни и те же люди по одним и тем же направлениям, и срок
прибытия у каждого направления известен заранее: Ош — Бишкек это десять часов,
Урумчи — Кашгар свои. Держать это в голове и проставлять руками в каждой
строке — лишняя работа и источник ошибок, поэтому справочник общий на всю
контору: точки заводит администратор, а таблицы подставляют время сами.
"""
from django.core.validators import MinValueValidator
from django.db import models

from apps.core.models import TimeStampedModel, UUIDModel


class Place(UUIDModel, TimeStampedModel):
    """Точка маршрута: город, склад, пункт пропуска."""

    name = models.CharField("Название", max_length=80, unique=True)
    # Название пишут по-разному: «Ташкент», «TASHKENT», «ташкент». Приводим
    # к одному виду, чтобы сопоставлять написанное в таблице со справочником.
    key = models.CharField("Ключ сопоставления", max_length=80, unique=True, db_index=True)
    is_active = models.BooleanField("Показывать", default=True, db_index=True)
    order = models.PositiveIntegerField("Порядок", default=100)

    class Meta:
        db_table = "route_places"
        verbose_name = "Точка маршрута"
        verbose_name_plural = "Точки маршрута"
        ordering = ("order", "name")

    def __str__(self):
        return self.name

    @staticmethod
    def make_key(name: str) -> str:
        """Приводит написание к сравнимому виду — как это делает таблица."""
        return " ".join((name or "").strip().lower().replace("ё", "е").split())

    def save(self, *args, **kwargs):
        self.key = self.make_key(self.name)
        super().save(*args, **kwargs)


class RouteLeg(UUIDModel, TimeStampedModel):
    """Плечо маршрута: сколько времени занимает дорога от точки до точки."""

    origin = models.ForeignKey(Place, verbose_name="Откуда", on_delete=models.CASCADE,
                               related_name="legs_out")
    destination = models.ForeignKey(Place, verbose_name="Куда", on_delete=models.CASCADE,
                                    related_name="legs_in")
    # В часах, дробью: «10.5» — десять с половиной. Минуты отдельным полем не
    # заводим: норматив всё равно приблизительный, до получаса.
    hours = models.DecimalField("Часов в пути", max_digits=6, decimal_places=2,
                                validators=[MinValueValidator(0.1)])
    note = models.CharField("Примечание", max_length=200, blank=True)

    class Meta:
        db_table = "route_legs"
        verbose_name = "Плечо маршрута"
        verbose_name_plural = "Плечи маршрута"
        ordering = ("origin__name", "destination__name")
        constraints = [
            models.UniqueConstraint(fields=("origin", "destination"), name="uniq_route_leg"),
            models.CheckConstraint(check=~models.Q(origin=models.F("destination")),
                                   name="route_leg_not_self"),
        ]

    def __str__(self):
        return f"{self.origin} → {self.destination}: {self.hours} ч"


class TransitAmount(UUIDModel, TimeStampedModel):
    """Сумма транзита, которую предлагают в таблице на выбор.

    Транзит берут не любой: это несколько заранее оговорённых сумм, одних
    и тех же для всей конторы. Список общий и правит его администратор —
    иначе в каждой таблице завелись бы свои числа, и сверить их было бы нельзя.

    Суммы в долларах: в них ведётся колонка транзита, как и колонка суммы.
    """

    amount = models.DecimalField("Сумма, $", max_digits=12, decimal_places=2,
                                 unique=True, validators=[MinValueValidator(0.01)])
    note = models.CharField("Пояснение", max_length=120, blank=True)
    is_active = models.BooleanField("Показывать", default=True, db_index=True)
    order = models.PositiveIntegerField("Порядок", default=100)

    class Meta:
        db_table = "route_transit_amounts"
        verbose_name = "Сумма транзита"
        verbose_name_plural = "Суммы транзита"
        ordering = ("order", "amount")

    def __str__(self):
        return f"{self.amount} $"
