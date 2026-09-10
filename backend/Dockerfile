# Контекст сборки — корень проекта: docker build -f backend/Dockerfile .
# --- Стадия сборки зависимостей ---
FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /build

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --prefix=/install -r requirements.txt

# --- Финальный образ ---
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings

# libpq — драйвер Postgres; остальное нужно WeasyPrint для вывода PDF:
# без этих библиотек экспорт падает уже во время работы, а не при сборке.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpq5 curl \
        libcairo2 libpango-1.0-0 libpangoft2-1.0-0 libgdk-pixbuf-2.0-0 \
        libffi8 shared-mime-info fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system app \
    && useradd --system --gid app --home /app app

WORKDIR /app

COPY --from=builder /install /usr/local
COPY --chown=app:app backend/ /app/

RUN mkdir -p /app/staticfiles /app/mediafiles && chown -R app:app /app/staticfiles /app/mediafiles

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/health/ || exit 1

# Daphne, а не gunicorn: приложение обслуживает и HTTP, и WebSocket.
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
