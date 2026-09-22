"""Курс доллара к сому.

Суммы в журнале пишут в сомах, а считают в долларах, поэтому курс нужен
на каждую введённую сумму. Берём официальный курс Национального банка КР:
он один для всей конторы, меняется раз в сутки и не зависит от того, кто
и когда открыл таблицу.

Чужой сайт может не ответить, поэтому последний удачный курс остаётся
в кеше надолго и отдаётся, пока не приедет свежий. Курс «ниоткуда» тут хуже
вчерашнего: без него сумма не пересчитается вовсе.
"""
import logging
import re
import urllib.error
import urllib.request
from datetime import date
from decimal import Decimal, InvalidOperation

from django.core.cache import cache

logger = logging.getLogger(__name__)

NBKR_URL = "https://www.nbkr.kg/XML/daily.xml"

# Свежий курс живёт сутки: Нацбанк обновляет его раз в день.
FRESH_TTL = 60 * 60 * 24
# Последний удачный курс держим месяц — он пригодится, если сайт лежит.
FALLBACK_TTL = 60 * 60 * 24 * 30

FRESH_KEY = "rate.usd.fresh"
FALLBACK_KEY = "rate.usd.last"

# Запрос не должен задерживать ответ приложения: не ответили за три секунды —
# отдаём сохранённый курс.
TIMEOUT = 3

# Разумные границы: и защита от опечатки в чужом ответе, и признак того,
# что разбор пошёл не туда.
MIN_RATE = Decimal("10")
MAX_RATE = Decimal("1000")

_USD = re.compile(
    r"<Currency\b[^>]*ISOCode=\"USD\"[^>]*>.*?<Value>\s*([\d\s,.]+?)\s*</Value>",
    re.IGNORECASE | re.DOTALL,
)


def usd_rate() -> dict:
    """Сколько сомов за доллар: {'rate': 87.45, 'source': …, 'date': …}."""
    fresh = cache.get(FRESH_KEY)
    if fresh:
        return fresh

    fetched = _fetch()
    if fetched is not None:
        value = {"rate": float(fetched), "source": "nbkr", "date": date.today().isoformat()}
        cache.set(FRESH_KEY, value, FRESH_TTL)
        cache.set(FALLBACK_KEY, value, FALLBACK_TTL)
        return value

    stale = cache.get(FALLBACK_KEY)
    if stale:
        # Тот же курс, но честно помеченный устаревшим: интерфейс скажет,
        # что курс вчерашний, вместо того чтобы выдать его за сегодняшний.
        return {**stale, "source": "cache"}

    return {"rate": None, "source": "unavailable", "date": None}


def _fetch() -> Decimal | None:
    try:
        request = urllib.request.Request(NBKR_URL, headers={"User-Agent": "ALI trade"})
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            # Ответ маленький (десятки килобайт), но читаем с ограничением:
            # чужой сайт не должен уметь занять нашу память.
            text = response.read(1024 * 1024).decode("utf-8", errors="replace")
    except (urllib.error.URLError, OSError, ValueError) as error:
        logger.warning("Курс НБ КР не получен: %s", error)
        return None

    match = _USD.search(text)
    if match is None:
        logger.warning("В ответе НБ КР нет курса доллара")
        return None

    # В ответе дробная часть отделена запятой: «87,4500».
    raw = match.group(1).replace(" ", "").replace("\xa0", "").replace(",", ".")
    try:
        rate = Decimal(raw)
    except InvalidOperation:
        logger.warning("Курс НБ КР не разобран: %r", raw)
        return None

    if not (MIN_RATE <= rate <= MAX_RATE):
        logger.warning("Курс НБ КР вне разумных границ: %s", rate)
        return None
    return rate
