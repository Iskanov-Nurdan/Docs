from django.urls import path

from apps.users.admin_api import AdminSummaryView, AdminUserDetailView, AdminUsersView
from apps.users.views import (
    ChangePasswordView,
    ConfirmEmailView,
    LoginView,
    LogoutView,
    MeView,
    PasswordResetConfirmView,
    PasswordResetRequestView,
    SessionRefreshView,
    UserSearchView,
)

urlpatterns = [
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

    # Административная часть: доступна только сотрудникам (is_staff).
    path("admin/users/", AdminUsersView.as_view(), name="admin-users"),
    path("admin/users/<int:user_id>/", AdminUserDetailView.as_view(), name="admin-user-detail"),
    path("admin/summary/", AdminSummaryView.as_view(), name="admin-summary"),
]
