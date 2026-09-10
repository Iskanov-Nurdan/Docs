from django.urls import path

from apps.users.views import (
    ChangePasswordView,
    ConfirmEmailView,
    LoginView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    RegisterView,
    SessionRefreshView,
    UserSearchView,
)

urlpatterns = [
    path("auth/register/", RegisterView.as_view(), name="register"),
    path("auth/login/", LoginView.as_view(), name="login"),
    path("auth/logout/", LogoutView.as_view(), name="logout"),
    path("auth/refresh/", SessionRefreshView.as_view(), name="token-refresh"),
    path("auth/confirm-email/", ConfirmEmailView.as_view(), name="confirm-email"),
    path("auth/password/reset/", PasswordResetRequestView.as_view(), name="password-reset"),
    path("auth/password/reset/confirm/", PasswordResetConfirmView.as_view(),
         name="password-reset-confirm"),
    path("auth/password/change/", ChangePasswordView.as_view(), name="password-change"),
    path("users/me/", MeView.as_view(), name="users-me"),
    path("users/search/", UserSearchView.as_view(), name="users-search"),
]
