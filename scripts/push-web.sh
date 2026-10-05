#!/usr/bin/env bash
#
# Выкладка фронтенда на сервер одной командой, с очисткой лишнего:
#
#     SERVER=root@1.2.3.4 ./scripts/push-web.sh            # собрать и выложить
#     SERVER=root@1.2.3.4 ./scripts/push-web.sh --no-build # выложить уже собранный web/
#     SERVER=root@1.2.3.4 ./scripts/push-web.sh --dry-run  # только показать, что изменится
#
# Что делает:
#   1. собирает фронтенд (scripts/build-web.sh), если не указан --no-build;
#   2. заливает web/ в соседнюю папку web.new на сервере (rsync не нужен — tar по ssh);
#   3. сравнивает со старым web/ и показывает файлы, которых в новой сборке нет;
#   4. копирует новые файлы в web/ (index.html последним) и удаляет устаревшие
#      хэш-файлы (assets/index-xxxx.js). Саму папку web/ не пересоздаёт —
#      она смонтирована в контейнер nginx.
#
# Переменные:
#   SERVER      user@host (обязательно)
#   REMOTE_DIR  каталог проекта на сервере (по умолчанию /opt/alitrade)
set -euo pipefail

cd "$(dirname "$0")/.."

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
fail() { echo "${RED}✗ $1${OFF}" >&2; exit 1; }
step() { echo; echo "${YELLOW}▸ $1${OFF}"; }

SERVER="${SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/alitrade}"
BUILD=yes
DRY=no

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD=no ;;
    --dry-run)  DRY=yes ;;
    *) fail "Неизвестный параметр: $arg" ;;
  esac
done

[ -n "$SERVER" ] || fail "Укажите сервер: SERVER=root@IP ./scripts/push-web.sh"
command -v ssh >/dev/null || fail "Не найден ssh."
command -v tar >/dev/null || fail "Не найден tar."

if [ "$BUILD" = yes ]; then
  step "Собираем фронтенд"
  ./scripts/build-web.sh
fi

[ -f web/index.html ] || fail "В web/ нет index.html — сначала соберите фронтенд."

# --------------------------- Что есть на сервере ---------------------------

step "Сравниваем с тем, что лежит на сервере"

LOCAL_LIST="$(cd web && find . -type f | sort)"
REMOTE_LIST="$(ssh "$SERVER" "cd '$REMOTE_DIR/web' 2>/dev/null && find . -type f | sort || true")"

# Есть на сервере, но нет в новой сборке — устарело.
STALE="$(comm -13 <(echo "$LOCAL_LIST") <(echo "$REMOTE_LIST") | sed '/^$/d' || true)"
# Есть в новой сборке, но нет на сервере — добавится.
ADDED="$(comm -23 <(echo "$LOCAL_LIST") <(echo "$REMOTE_LIST") | sed '/^$/d' || true)"

echo "  Локально файлов:     $(echo "$LOCAL_LIST" | sed '/^$/d' | wc -l)"
echo "  На сервере файлов:   $(echo "$REMOTE_LIST" | sed '/^$/d' | wc -l)"
echo "  Добавится:           $(echo "$ADDED" | sed '/^$/d' | wc -l)"
echo "  Будет удалено:       $(echo "$STALE" | sed '/^$/d' | wc -l)"

if [ -n "$STALE" ]; then
  echo
  echo "  Лишние файлы на сервере (удалятся):"
  echo "$STALE" | sed 's/^/    - /'
fi

if [ "$DRY" = yes ]; then
  echo
  echo "${GREEN}✓ Пробный запуск: на сервере ничего не менялось.${OFF}"
  exit 0
fi

# ------------------------------ Заливка и подмена ------------------------------

step "Заливаем в $REMOTE_DIR/web.new"
tar -C web -czf - . | ssh "$SERVER" "
  set -e
  rm -rf '$REMOTE_DIR/web.new'
  mkdir -p '$REMOTE_DIR/web.new'
  tar -xzf - -C '$REMOTE_DIR/web.new'
  chmod -R a+rX '$REMOTE_DIR/web.new'
"

step "Обновляем web/ и убираем лишнее"
# Папку web/ нельзя подменять переименованием: nginx смонтировал её в контейнер
# как каталог, и после замены контейнер продолжил бы видеть старую (уже
# удалённую). Поэтому файлы копируются внутрь той же папки.
# index.html кладётся последним, чтобы страница не ссылалась на ещё не
# приехавшие скрипты.
ssh "$SERVER" "
  set -e
  cd '$REMOTE_DIR'
  test -f web.new/index.html
  mkdir -p web
  (cd web.new && find . -type f ! -name index.html -exec cp --parents -f {} ../web/ \;)
  cp -f web.new/index.html web/index.html
  cd web
  while IFS= read -r f; do [ -n \"\$f\" ] && rm -f -- \"\$f\"; done <<'STALE_LIST'
$STALE
STALE_LIST
  find . -mindepth 1 -type d -empty -delete
  cd ..
  rm -rf web.new
  chmod -R a+rX web
"

echo
echo "${GREEN}✓ Фронтенд выложен. Перезапускать ничего не нужно.${OFF}"
echo "  В браузере обновите страницу с очисткой кэша: Ctrl+F5."
