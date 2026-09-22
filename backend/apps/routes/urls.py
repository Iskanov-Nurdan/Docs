from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.routes.views import PlaceViewSet, RouteLegViewSet, UsdRateView

router = DefaultRouter()
router.register("places", PlaceViewSet, basename="place")
router.register("route-legs", RouteLegViewSet, basename="route-leg")

urlpatterns = [
    path("rates/usd/", UsdRateView.as_view(), name="usd-rate"),
    path("", include(router.urls)),
]
