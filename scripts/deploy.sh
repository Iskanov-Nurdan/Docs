#!/usr/bin/env bash
#
# Разворачивание на сервере одной командой:
#
#     ./scripts/deploy.sh
#
# Скрипт делает всё по порядку: проверяет настройки, собирает образы,
# поднимает службы, выпускает сертификат TLS и переключает nginx на https.
# Повторный запуск обновляет уже работающую установку — сертификат при этом
# не перевыпускается, он продлевается сам.
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.prod.yml"
RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'

fail() { echo "${RED}✗ $1${OFF}" >&2; exit 1; }
step() { echo; echo "${YELLOW}▸ $1${OFF}"; }
done_() { echo "${GREEN}✓ $1${OFF}"; }

# --------------------------- Проверка окружения ---------------------------

command -v docker >/dev/null || fail "Docker не установлен."
docker compose version >/dev/null 2>&1 || fail "Нужен Docker Compose v2 (команда «docker compose»)."

if [ ! -f .env ]; then
  cp .env.prod.example .env
  fail "Создан файл .env из образца. Заполните его (пароли, домен, почта) и запустите скрипт снова."
fi

# Значения читаем из .env, не полагаясь на окружение оболочки.
#
# `|| true` обязателен: при включённом `set -e` grep, не нашедший строки,
# заканчивает скрипт молча — развёртывание обрывалось сразу после первой
# проверки, стоило в .env не оказаться необязательной переменной.
get() {
  grep -E "^$1=" .env | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" | tr -d '\r' || true
}

DOMAIN="$(get DOMAIN)"
EMAIL="$(get LETSENCRYPT_EMAIL)"
SECRET="$(get DJANGO_SECRET_KEY)"
DB_PASSWORD="$(get POSTGRES_PASSWORD)"
DEBUG="$(get DJANGO_DEBUG)"

[ -n "$DOMAIN" ] || fail "В .env не задан DOMAIN — имя, по которому открывается приложение."
[ -n "$EMAIL" ] || fail "В .env не задан LETSENCRYPT_EMAIL — на него придёт предупреждение, если сертификат перестанет продлеваться."
[ -n "$DB_PASSWORD" ] && [ "$DB_PASSWORD" != "change-me" ] || fail "Задайте POSTGRES_PASSWORD в .env."
[ ${#SECRET} -ge 40 ] || fail "DJANGO_SECRET_KEY короче 40 символов. Сгенерировать: openssl rand -base64 48"
case "$(echo "$DEBUG" | tr '[:upper:]' '[:lower:]')" in
  false|0|no|"") ;;
  *) fail "DJANGO_DEBUG должен быть False: с ним наружу уходят тексты ошибок вместе с настройками." ;;
esac

# Заглушки из образца в бою означают неработающий вход и потерянные письма.
grep -q "^DJANGO_ALLOWED_HOSTS=.*$DOMAIN" .env || fail "В DJANGO_ALLOWED_HOSTS нет $DOMAIN — Django ответит «Invalid HTTP_HOST»."
grep -q "^CSRF_TRUSTED_ORIGINS=.*https://$DOMAIN" .env || fail "В CSRF_TRUSTED_ORIGINS нет https://$DOMAIN."

done_ "Настройки на месте: $DOMAIN"

# Фронтенд приезжает собранным: сервер его не строит. Без этой папки nginx
# отдавал бы пустоту, и человек видел бы белый экран вместо приложения.
WEB_DIR="$(get WEB_DIR)"
WEB_DIR="${WEB_DIR:-./web}"

if [ ! -f "$WEB_DIR/index.html" ]; then
  fail "В $WEB_DIR нет собранного фронтенда (index.html).
  Соберите его на своей машине и положите сюда:
      ./scripts/build-web.sh
      rsync -az --delete web/ root@ЭТОТ-СЕРВЕР:$(pwd)/web/"
fi

done_ "Фронтенд на месте: $(find "$WEB_DIR" -type f | wc -l) файлов в $WEB_DIR"

# --------------------------- Конфигурация nginx ---------------------------

# Есть ли уже выпущенный сертификат. Проверяем в томе, а не на диске: файлы
# лежат внутри docker, на хосте их нет.
has_cert() {
  # Смотрим прямо в каталог тома на диске, без запуска контейнера: тот тянул
  # бы образ из сети, и на медленном канале проверка выглядела зависанием —
  # скрипт молчал минутами, ничего не печатая.
  local dir
  dir="$(docker volume inspect docs-prod_certbot_certs --format '{{ .Mountpoint }}' 2>/dev/null || true)"
  [ -n "$dir" ] && [ -d "$dir/live/$DOMAIN" ]
}

use_config() {
  sed "s/__DOMAIN__/$DOMAIN/g" "nginx/$1" > nginx/active.conf
}

step "Проверяем, есть ли уже сертификат"

if has_cert; then
  step "Сертификат уже выпущен — сразу поднимаем https"
  use_config prod.conf
  CERT_NEEDED=no
else
  step "Сертификата ещё нет — первый запуск пойдёт по http"
  use_config prod-bootstrap.conf
  CERT_NEEDED=yes
fi

# ------------------------------ Запуск служб ------------------------------

step "Собираем образ приложения и поднимаем службы (в первый раз это несколько минут)"
# Собирается только бэкенд: фронтенд уже готов и лежит в web/.
$COMPOSE up -d --build

# Занятый порт — самая частая причина, по которой не поднимается nginx: на
# сервере уже работает свой веб-сервер, и docker не может занять 80-й.
if command -v ss >/dev/null && ss -tln | grep -qE ':(80|443) '; then
  if ! $COMPOSE ps --format '{{.Service}}' 2>/dev/null | grep -q nginx; then
    fail "Порт 80 или 443 занят другой программой — обычно это системный nginx.
  Освободите их и запустите скрипт снова:
      systemctl stop nginx && systemctl disable nginx"
  fi
fi

step "Ждём, пока приложение ответит"
echo "  Первый запуск дольше обычного: применяются миграции базы."

# Спрашиваем состояние у самого docker, а не заходим внутрь контейнера:
# «compose exec» поднимает отдельный процесс на каждую попытку, и на слабом
# сервере опрос выходил дороже того, что опрашивает.
for i in $(seq 1 120); do
  state="$(docker inspect --format '{{ .State.Health.Status }}' docs-prod-api-1 2>/dev/null || echo unknown)"

  if [ "$state" = healthy ]; then
    done_ "Приложение отвечает"
    break
  fi

  if [ "$state" = unhealthy ]; then
    fail "Приложение поднялось, но отвечает ошибкой. Смотрите: $COMPOSE logs api"
  fi

  # Раз в полминуты показываем, что ожидание живое, и чем занято приложение.
  if [ $((i % 15)) = 0 ]; then
    echo "  …ещё ждём ($((i * 2)) с). Последнее из журнала:"
    $COMPOSE logs api --tail 2 2>/dev/null | sed 's/^/    /'
  fi

  [ "$i" = 120 ] && fail "Приложение не поднялось за четыре минуты. Смотрите: $COMPOSE logs api"
  sleep 2
done

# ---------------------------- Сертификат TLS ----------------------------

if [ "$CERT_NEEDED" = yes ]; then
  step "Выпускаем сертификат для $DOMAIN"
  echo "  Домен должен уже указывать A-записью на этот сервер, а порт 80 — быть открыт."

  $COMPOSE run --rm --entrypoint certbot certbot certonly \
    --webroot -w /var/www/certbot \
    -d "$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos --no-eff-email --non-interactive \
    || fail "Let's Encrypt не выдал сертификат. Частые причины: домен не указывает на этот сервер, порт 80 закрыт, исчерпан дневной предел попыток."

  step "Переключаем nginx на https"
  use_config prod.conf
  $COMPOSE restart nginx
  done_ "Сертификат получен, продление берёт на себя служба certbot"
fi

# --------------------------------- Итог ---------------------------------

step "Готово"
$COMPOSE ps
echo
echo "  Приложение:     https://$DOMAIN"
echo "  Панель админа:  https://$DOMAIN/django-admin/"
echo
echo "  Первый пользователь заводится так:"
echo "    $COMPOSE exec api python manage.py createsuperuser"
echo
echo "  Обновить фронт: ./scripts/build-web.sh на своей машине, затем"
echo "                  rsync -az --delete web/ root@сервер:$(pwd)/web/"
echo "  Журналы:        $COMPOSE logs -f api"
echo "  Остановить:     $COMPOSE down"
