#!/usr/bin/env bash
#
# Выкладка установщиков приложения на страницу «Скачать» (/download).
#
#     ./scripts/push-desktop.sh                          # только разложить в downloads/ (локальная проверка)
#     SERVER=root@1.2.3.4 ./scripts/push-desktop.sh      # и выложить на сервер
#
# Берёт из desktop/dist/ установщики текущей версии (version в
# desktop/package.json):
#   ALI-trade-Setup-<версия>.exe   — Windows, собирается `npm run dist`;
#   ALI-trade-<версия>-mac.dmg     — macOS, собирается на Mac или в GitHub
#                                    Actions (.github/workflows/desktop.yml).
# Хотя бы один должен быть. Рядом пишет downloads/latest.json — по нему
# страница узнаёт версию, имена и размеры файлов.
#
# На сервере сначала приезжают установщики, потом latest.json: страница ни на
# миг не ссылается на файл, которого ещё нет. Старые версии удаляются после.
#
# Переменные:
#   SERVER      user@host — если не задан, на сервер ничего не уходит
#   REMOTE_DIR  каталог проекта на сервере (по умолчанию /opt/alitrade)
set -euo pipefail

cd "$(dirname "$0")/.."

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'
fail() { echo "${RED}✗ $1${OFF}" >&2; exit 1; }
step() { echo; echo "${YELLOW}▸ $1${OFF}"; }

SERVER="${SERVER:-}"
REMOTE_DIR="${REMOTE_DIR:-/opt/alitrade}"

# Частая ошибка: «SERVER=ssh root@…». Ловим её до ssh с непонятной ошибкой.
case "$SERVER" in
  *" "*) fail "В SERVER должен быть только адрес: SERVER=root@1.2.3.4 (без «ssh»)." ;;
esac

[ -f desktop/package.json ] || fail "Нет desktop/package.json — запускайте из папки проекта."
VERSION="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' desktop/package.json | head -1)"
[ -n "$VERSION" ] || fail "Не удалось прочитать version из desktop/package.json."

WIN_FILE="ALI-trade-Setup-$VERSION.exe"
MAC_FILE="ALI-trade-$VERSION-mac.dmg"

step "Версия $VERSION — ищем установщики в desktop/dist/"
HAVE_WIN=no; HAVE_MAC=no
[ -f "desktop/dist/$WIN_FILE" ] && HAVE_WIN=yes
[ -f "desktop/dist/$MAC_FILE" ] && HAVE_MAC=yes
echo "  Windows: $([ $HAVE_WIN = yes ] && echo "$WIN_FILE" || echo 'нет')"
echo "  macOS:   $([ $HAVE_MAC = yes ] && echo "$MAC_FILE" || echo 'нет')"
[ $HAVE_WIN = yes ] || [ $HAVE_MAC = yes ] || fail "Нет ни одного установщика. Соберите: cd desktop && npm run dist"

size() { wc -c < "$1" | tr -d ' '; }
entry() { echo "{\"file\": \"$1\", \"size\": $(size "desktop/dist/$1")}"; }

step "Раскладываем в downloads/"
mkdir -p downloads
# Старые версии из локальной папки убираем: страница показывает только текущую.
find downloads -maxdepth 1 -type f \( -name '*.exe' -o -name '*.dmg' \) \
  ! -name "$WIN_FILE" ! -name "$MAC_FILE" -delete
[ $HAVE_WIN = yes ] && cp -f "desktop/dist/$WIN_FILE" downloads/
[ $HAVE_MAC = yes ] && cp -f "desktop/dist/$MAC_FILE" downloads/

cat > downloads/latest.json <<JSON
{
  "version": "$VERSION",
  "published": "$(date +%Y-%m-%d)",
  "windows": $([ $HAVE_WIN = yes ] && entry "$WIN_FILE" || echo null),
  "mac": $([ $HAVE_MAC = yes ] && entry "$MAC_FILE" || echo null)
}
JSON
cat downloads/latest.json

if [ -z "$SERVER" ]; then
  echo
  echo "${GREEN}✓ Разложено в downloads/. На сервер не выкладывали: SERVER не задан.${OFF}"
  echo "  Локально страница: http://localhost:8080/download"
  exit 0
fi

command -v ssh >/dev/null || fail "Не найден ssh."
command -v tar >/dev/null || fail "Не найден tar."

step "Заливаем установщики в $REMOTE_DIR/downloads"
# latest.json пока не трогаем — сначала файлы, на которые он сошлётся.
tar -C downloads -czf - --exclude latest.json . | ssh "$SERVER" "
  set -e
  mkdir -p '$REMOTE_DIR/downloads'
  tar -xzf - -C '$REMOTE_DIR/downloads'
"

step "Публикуем latest.json и убираем старые версии"
ssh "$SERVER" "cat > '$REMOTE_DIR/downloads/latest.json.new'" < downloads/latest.json
ssh "$SERVER" "
  set -e
  cd '$REMOTE_DIR/downloads'
  mv -f latest.json.new latest.json
  find . -maxdepth 1 -type f \\( -name '*.exe' -o -name '*.dmg' \\) \
    ! -name '$WIN_FILE' ! -name '$MAC_FILE' -delete
  chmod -R a+rX .
"

echo
echo "${GREEN}✓ Выложено. Страница: https://<ваш домен>/download${OFF}"
echo "  Если nginx ещё не знает про /downloads/, один раз запустите на сервере ./scripts/deploy.sh."
