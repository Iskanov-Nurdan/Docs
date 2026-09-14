#!/usr/bin/env bash
#
# Сборка фронтенда для сервера.
#
#     ./scripts/build-web.sh
#
# Собирает на своей машине и складывает готовое в web/ — эту папку и увозят
# на сервер. Сервер сборкой не занимается: ему не нужны ни node, ни зависимости,
# ни исходники, а выкладка занимает секунды вместо минут.
#
# Собирается внутри контейнера node, поэтому node на машине не нужен — и
# результат не зависит от того, какая версия стоит у того, кто собирает.
set -euo pipefail

cd "$(dirname "$0")/.."

GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
step() { echo; echo "${YELLOW}▸ $1${OFF}"; }

command -v docker >/dev/null || { echo "${RED}✗ Docker не установлен.${OFF}" >&2; exit 1; }

# Git Bash на Windows переписывает пути, которые выглядят как unix-овые:
# «-w /app» превращается в «C:/Program Files/Git/app», и docker отказывается
# работать. Внутри контейнера путь должен остаться таким, каким написан.
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL='*'

# Путь к папке для docker: на Windows нужен вид «C:/...», в остальных системах
# подойдёт обычный. `pwd -W` есть только в Git Bash, поэтому с запасным вариантом.
HOST_DIR="$(pwd -W 2>/dev/null || pwd)"

# Адрес API уходит в код на сборке: Vite подставляет его в готовые файлы, и
# после сборки менять уже нечего. Пустые значения означают «тот же адрес, что
# и страница» — приложение и API живут на одном домене.
API_URL="${VITE_API_URL:-/api}"
WS_URL="${VITE_WS_URL:-}"

step "Собираем фронтенд (node в контейнере, ставить ничего не нужно)"
docker run --rm \
  -v "$HOST_DIR/frontend:/app" \
  -w /app \
  -e VITE_API_URL="$API_URL" \
  -e VITE_WS_URL="$WS_URL" \
  node:22-alpine \
  sh -c "npm ci --no-audit --no-fund || npm install --no-audit --no-fund; npm run build"

step "Складываем результат в web/"
rm -rf web
mkdir -p web
cp -r frontend/dist/. web/

# index.html без скриптов — признак того, что сборка сломалась молча.
test -f web/index.html || { echo "${RED}✗ Сборка не дала index.html.${OFF}" >&2; exit 1; }

SIZE=$(du -sh web | cut -f1)
FILES=$(find web -type f | wc -l)

echo
echo "${GREEN}✓ Готово: web/ — $FILES файлов, $SIZE${OFF}"
echo
echo "  Отправить на сервер:"
echo "    rsync -az --delete web/ root@СЕРВЕР:/opt/alitrade/web/"
echo
echo "  Или, если rsync нет (Windows):"
echo "    scp -r web root@СЕРВЕР:/opt/alitrade/"
echo
echo "  После этого на сервере ничего перезапускать не нужно:"
echo "  nginx отдаёт файлы с диска и подхватывает новые сам."
