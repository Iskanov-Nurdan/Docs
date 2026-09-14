"""Настройки проекта: веб-редактор документов."""
import os
import sys
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
# .env ищется рядом с manage.py, затем в корне репозитория — один файл
# работает и при локальном запуске, и в контейнере.
load_dotenv(BASE_DIR / ".env")
load_dotenv(BASE_DIR.parent / ".env")


def env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.getenv(name, default).split(",") if item.strip()]


def env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


DEBUG = env_bool("DJANGO_DEBUG", False)

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    # В разработке ключ генерируется на лету; в бою переменная обязательна.
    if DEBUG:
        from django.core.management.utils import get_random_secret_key

        SECRET_KEY = get_random_secret_key()
    else:
        raise ImproperlyConfigured(
            "Переменная DJANGO_SECRET_KEY обязательна при DJANGO_DEBUG=False."
        )

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]")

INSTALLED_APPS = [
    "daphne",  # раньше staticfiles: подменяет runserver на ASGI
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    # third-party
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "corsheaders",
    "channels",
    # local
    "apps.core",
    "apps.users",
    "apps.documents",
    "apps.permissions",
    "apps.comments",
    "apps.versions",
    "apps.notifications",
    "apps.doc_templates",
    "apps.routes",
    "apps.files",
    "apps.publishing",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "apps.core.middleware.RequestLogMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("POSTGRES_DB", "docs"),
        "USER": os.getenv("POSTGRES_USER", "docs"),
        "PASSWORD": os.getenv("POSTGRES_PASSWORD", ""),
        "HOST": os.getenv("POSTGRES_HOST", "localhost"),
        "PORT": os.getenv("POSTGRES_PORT", "5432"),
        "CONN_MAX_AGE": 60,
    }
}

AUTH_USER_MODEL = "users.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "ru"
LANGUAGES = [("ru", "Русский"), ("ky", "Кыргызча"), ("en", "English")]
LOCALE_PATHS = [BASE_DIR / "locale"]
TIME_ZONE = os.getenv("DJANGO_TIME_ZONE", "Asia/Bishkek")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "mediafiles"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Файлы уходят в S3, как только заданы реквизиты; иначе — локальный каталог,
# чтобы поднять проект можно было без внешнего хранилища.
S3_ENDPOINT_URL = os.getenv("S3_ENDPOINT_URL", "")
if S3_ENDPOINT_URL:
    STORAGES = {
        "default": {
            "BACKEND": "storages.backends.s3.S3Storage",
            "OPTIONS": {
                "endpoint_url": S3_ENDPOINT_URL,
                "access_key": os.getenv("S3_ACCESS_KEY", ""),
                "secret_key": os.getenv("S3_SECRET_KEY", ""),
                "bucket_name": os.getenv("S3_BUCKET", "docs"),
                "region_name": os.getenv("S3_REGION", ""),
                "file_overwrite": False,
                "default_acl": None,
            },
        },
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }
else:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "whitenoise.storage.CompressedStaticFilesStorage"},
    }

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": ("rest_framework.permissions.IsAuthenticated",),
    # Сколько наших прокси стоит перед приложением. Значение обязательное:
    # без него DRF берёт идентификатором для счётчика попыток весь заголовок
    # X-Forwarded-For целиком, а его первое значение подставляет клиент.
    # Новый заголовок на каждый запрос — и лимит на вход переставал работать
    # вовсе: триста попыток подряд проходили при пределе десять в минуту.
    "NUM_PROXIES": env_int("NUM_PROXIES", 1),
    # Параметр ?format= у DRF выбирает рендерер и на неизвестном значении
    # отвечает 404. У нас это параметр выгрузки (/export/?format=pdf),
    # поэтому подбор рендерера через строку запроса отключён.
    "URL_FORMAT_OVERRIDE": None,
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.OrderingFilter",
        "rest_framework.filters.SearchFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "apps.core.pagination.DefaultPagination",
    "PAGE_SIZE": 30,
    "EXCEPTION_HANDLER": "apps.core.exceptions.api_exception_handler",
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.ScopedRateThrottle",
        "rest_framework.throttling.AnonRateThrottle",
    ),
    "DEFAULT_THROTTLE_RATES": {
        # Подбор пароля
        "login": os.getenv("THROTTLE_LOGIN", "10/min"),
        "anon": os.getenv("THROTTLE_ANON", "60/min"),
        "export": os.getenv("THROTTLE_EXPORT", "20/hour"),
    },
    "DATETIME_FORMAT": "%Y-%m-%dT%H:%M:%S%z",
}

# В тестах ограничение частоты только мешает.
if "test" in sys.argv:
    REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"] = {
        key: None for key in REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]
    }

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=env_int("JWT_ACCESS_MINUTES", 30)),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=env_int("JWT_REFRESH_DAYS", 14)),
    # Сессия продлевается сама, пока пользователь работает; использованный
    # refresh отзывается, чтобы украденный токен не давал вечный доступ.
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
}

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379/0")

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    }
}

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": REDIS_URL,
        "OPTIONS": {"CLIENT_CLASS": "django_redis.client.DefaultClient"},
    }
}

CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TIMEZONE = TIME_ZONE
CELERY_TASK_TIME_LIMIT = 600
CELERY_TASK_SOFT_TIME_LIMIT = 540

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:5173")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS", "http://localhost:5173")

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "")
EMAIL_PORT = env_int("EMAIL_PORT", 587)
EMAIL_USE_TLS = env_bool("EMAIL_USE_TLS", True)
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", "noreply@localhost")

# Загружаемые файлы: предел проверяется и здесь, и в сериализаторе файлов.
MAX_UPLOAD_BYTES = env_int("MAX_UPLOAD_MB", 25) * 1024 * 1024
MAX_DOCUMENT_BYTES = env_int("MAX_DOCUMENT_MB", 10) * 1024 * 1024
DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_BYTES
FILE_UPLOAD_MAX_MEMORY_SIZE = 5 * 1024 * 1024

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_BROWSER_XSS_FILTER = True
    X_FRAME_OPTIONS = "DENY"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {"format": "[{asctime}] {levelname} {name}: {message}", "style": "{"},
    },
    "handlers": {"console": {"class": "logging.StreamHandler", "formatter": "verbose"}},
    "root": {"handlers": ["console"], "level": os.getenv("LOG_LEVEL", "INFO")},
    "loggers": {
        "apps": {
            "handlers": ["console"],
            "level": os.getenv("LOG_LEVEL", "INFO"),
            "propagate": False,
        },
        "django.db.backends": {"level": "WARNING", "handlers": ["console"], "propagate": False},
    },
}
