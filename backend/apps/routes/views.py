"""API справочника: читают все, правит администратор.

Расчёта времени здесь нет намеренно: справочник маленький, он целиком уходит
в браузер один раз, и таблица считает срок на месте — без запроса на каждую
изменённую ячейку.
"""
from rest_framework import serializers, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.core.exceptions import BusinessError
from apps.core.permissions import IsAdmin
from apps.routes.models import Place, RouteLeg, TransitAmount


class PlaceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Place
        fields = ("id", "name", "key", "is_active", "order")
        read_only_fields = ("id", "key")


class RouteLegSerializer(serializers.ModelSerializer):
    origin_name = serializers.CharField(source="origin.name", read_only=True)
    destination_name = serializers.CharField(source="destination.name", read_only=True)
    origin_key = serializers.CharField(source="origin.key", read_only=True)
    destination_key = serializers.CharField(source="destination.key", read_only=True)

    class Meta:
        model = RouteLeg
        fields = ("id", "origin", "destination", "origin_name", "destination_name",
                  "origin_key", "destination_key", "hours", "note")
        read_only_fields = ("id", "origin_name", "destination_name", "origin_key",
                            "destination_key")
        # Своей проверки на повтор здесь нет: повторное направление не ошибка,
        # а изменение времени — его обрабатывает create ниже. Стандартная
        # проверка сказала бы «поля должны производить массив с уникальными
        # значениями», чего человеку не понять.
        validators = ()

    def validate(self, attrs):
        origin = attrs.get("origin") or getattr(self.instance, "origin", None)
        destination = attrs.get("destination") or getattr(self.instance, "destination", None)
        if origin and destination and origin == destination:
            raise BusinessError("Точка отправления и прибытия совпадают.", code="same_place")
        return attrs


class TransitAmountSerializer(serializers.ModelSerializer):
    class Meta:
        model = TransitAmount
        fields = ("id", "amount", "note", "is_active", "order")
        read_only_fields = ("id",)


class TransitAmountViewSet(viewsets.ModelViewSet):
    """Суммы транзита: предлагаются в таблице на выбор."""

    serializer_class = TransitAmountSerializer

    def get_queryset(self):
        queryset = TransitAmount.objects.all()
        # Скрытую сумму видит только тот, кто правит список.
        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(is_active=True)
        return queryset

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAdmin()]
        return super().get_permissions()

    def list(self, request, *args, **kwargs):
        from rest_framework.response import Response

        return Response(self.get_serializer(self.get_queryset(), many=True).data)


class PlaceViewSet(viewsets.ModelViewSet):
    """Точки маршрута."""

    serializer_class = PlaceSerializer

    def get_queryset(self):
        queryset = Place.objects.all()
        # Скрытые точки видит только тот, кто их правит.
        if not (self.request.user.is_authenticated and self.request.user.is_staff):
            queryset = queryset.filter(is_active=True)
        return queryset

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAdmin()]
        return super().get_permissions()

    def list(self, request, *args, **kwargs):
        from rest_framework.response import Response

        return Response(self.get_serializer(self.get_queryset(), many=True).data)


class RouteLegViewSet(viewsets.ModelViewSet):
    """Плечи маршрута с нормативом времени."""

    serializer_class = RouteLegSerializer
    queryset = RouteLeg.objects.select_related("origin", "destination")

    def create(self, request, *args, **kwargs):
        """Заводит направление или меняет время у уже заведённого.

        Человек заполняет ту же форму и в первый раз, и когда правит норматив:
        «Китай — Алай, четыре часа». Отвечать на это ошибкой «уже существует»
        значит требовать искать строку в списке ниже ради того же самого.
        """
        from rest_framework.response import Response

        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        existing = RouteLeg.objects.filter(
            origin=data["origin"], destination=data["destination"],
        ).first()
        if existing is not None:
            existing.hours = data["hours"]
            if "note" in data:
                existing.note = data["note"]
            existing.save(update_fields=["hours", "note", "updated_at"])
            return Response(self.get_serializer(existing).data)

        serializer.save()
        return Response(serializer.data, status=201)

    def get_permissions(self):
        if self.action in ("create", "update", "partial_update", "destroy"):
            return [IsAdmin()]
        return super().get_permissions()

    def list(self, request, *args, **kwargs):
        from rest_framework.response import Response

        return Response(self.get_serializer(self.get_queryset(), many=True).data)


class UsdRateView(APIView):
    """Текущий курс доллара к сому — по нему таблица пересчитывает суммы.

    Читают все: сумму вводит любой, кто ведёт журнал. Менять курс руками
    нельзя намеренно — он официальный, и «свой» курс у каждого превратил бы
    суммы в несравнимые.
    """

    def get(self, request):
        from apps.routes.rates import usd_rate

        return Response(usd_rate())
