/**
 * Срок прибытия по справочнику маршрутов.
 *
 * Человек выбирает «откуда» и «куда» и пишет, во сколько машина вышла, —
 * время прибытия таблица ставит сама. Дальше работает то, что уже есть:
 * колонка срока краснеет, когда время прошло, а строка не закрыта.
 *
 * Считаем только пустую ячейку срока: проставленное руками время — это то,
 * о чём договорились с водителем, и оно важнее норматива из справочника.
 */
import type * as Y from 'yjs'
import { hoursBetween, placeKey } from '@/store/routes'
import type { RouteLeg } from '@/types'
import { ARRIVAL_COLUMNS, findColumn, isRowClosed, readRaw, writeCell, type SheetMap } from './model'
import { parseDeadline, statusTone } from './statuses'

/** Заголовки колонок, по которым собирается расчёт. */
export const ROUTE_COLUMNS = {
  from: ['откуда', 'пункт отправ', 'отправление', 'from', 'кайдан'],
  to: ['куда', 'пункт назнач', 'назначение', 'to', 'кайда'],
  // «Транзит» отсюда убран намеренно: теперь так называется денежная
  // колонка (см. money.ts), а точки по пути — это «Через».
  via: ['через', 'промежут', 'по пути', 'остановк', 'via'],
  date: ['дата', 'date', 'кун'],
  departure: ['вышел', 'выехал', 'выезд', 'отправил', 'чыкты', 'departure'],
  arrival: ['прибыт', 'приезд', 'срок', 'eta', 'жетуу', 'моонот'],
  passed: ['пройдено', 'отметки', 'прошёл', 'прошел', 'контроль'],
}

/** Двузначное число: «7» — это «07». */
const two = (value: number) => String(value).padStart(2, '0')

/** Дата и время в том виде, который понимает подсветка срока. */
export function formatMoment(moment: Date): string {
  return `${two(moment.getDate())}.${two(moment.getMonth() + 1)}.${moment.getFullYear()}`
    + ` ${two(moment.getHours())}:${two(moment.getMinutes())}`
}

/**
 * Момент выезда из «Даты» и «Вышел».
 *
 * Дата без времени — это начало дня, поэтому время подмешиваем отдельно:
 * «09.09.2026» плюс «08:30» даёт девятое число, половину девятого.
 */
function departureMoment(sheet: SheetMap, row: number,
                         dateCol: number | null, timeCol: number | null): Date | null {
  const dateText = dateCol === null ? '' : (readRaw(sheet, row, dateCol) ?? '')
  const timeText = timeCol === null ? '' : (readRaw(sheet, row, timeCol) ?? '')

  const onlyTime = /^(\d{1,2})[:.](\d{2})$/.exec(timeText.trim())
  const base = parseDeadline(dateText) ?? (timeText.trim() ? parseDeadline(timeText) : null)
  if (!base) return null

  const moment = new Date(base)

  if (onlyTime) {
    moment.setHours(Number(onlyTime[1]), Number(onlyTime[2]), 0, 0)
    return moment
  }

  // Дата без времени разбирается как конец дня — так и надо для срока
  // прибытия («до четырнадцатого» значит до вечера). Но выезд считается от
  // начала дня: иначе машина, вышедшая четырнадцатого, приезжала бы
  // пятнадцатого под утро, и весь расчёт выглядел бы бессмыслицей.
  if (!timeText.trim() && dateText.trim()) {
    moment.setHours(0, 0, 0, 0)
  }
  return moment
}

/** Разделители промежуточных точек: пишут и стрелкой, и запятой. */
const VIA_SPLIT = /\s*(?:→|->|,|;|\/|\|)\s*/

/** Точки по пути из ячейки «Через»: «Кашгар → Нарын» — это две точки. */
export function parseVia(text: string): string[] {
  return text.split(VIA_SPLIT).map((item) => item.trim()).filter(Boolean)
}

/** Как точки по пути записываются в ячейку. */
export const formatVia = (points: string[]) => points.filter(Boolean).join(' → ')

/**
 * Время между двумя точками по справочнику — кратчайшим путём через плечи.
 *
 * Прямого плеча «Иркештам — Достук» в справочнике нет: есть Иркештам →
 * Каратай → Т → Достук. Раньше время считалось только по прямому плечу или
 * по точкам, вписанным в «Через» до единой, и рейс без «Через» оставался без
 * срока — ни в форме, ни кнопкой «Посчитать сроки». Теперь путь по плечам
 * находится сам (алгоритм Дейкстры: плечей десятки, это мгновенно).
 */
export function pathHours(legs: RouteLeg[], from: string, to: string): number | null {
  const direct = hoursBetween(legs, from, to)
  if (direct !== null) return direct

  const start = placeKey(from)
  const goal = placeKey(to)
  if (!start || !goal || start === goal) return null

  const edges = new Map<string, Array<{ to: string; hours: number }>>()
  for (const leg of legs) {
    const hours = Number(leg.hours)
    if (!Number.isFinite(hours) || hours <= 0) continue
    const list = edges.get(leg.origin_key) ?? []
    list.push({ to: leg.destination_key, hours })
    edges.set(leg.origin_key, list)
  }

  const best = new Map<string, number>([[start, 0]])
  const done = new Set<string>()
  while (true) {
    let current: string | null = null
    for (const [key, value] of best) {
      if (!done.has(key) && (current === null || value < (best.get(current) as number))) current = key
    }
    if (current === null) return null
    if (current === goal) return best.get(current) as number
    done.add(current)
    for (const edge of edges.get(current) ?? []) {
      const candidate = (best.get(current) as number) + edge.hours
      if (candidate < (best.get(edge.to) ?? Infinity)) best.set(edge.to, candidate)
    }
  }
}

/**
 * Время на весь путь: от точки к точке по порядку, каждый участок — по
 * справочнику кратчайшим путём (см. pathHours).
 */
export function routeHours(legs: RouteLeg[], from: string, via: string[], to: string): number | null {
  const points = [from, ...via, to].map((item) => item.trim()).filter(Boolean)
  if (points.length < 2) return null

  let total = 0
  for (let index = 0; index < points.length - 1; index += 1) {
    const hours = pathHours(legs, points[index], points[index + 1])
    if (hours === null) return null
    total += hours
  }
  return total
}

/**
 * Какого участка не хватает, чтобы посчитать путь целиком.
 *
 * «Нет маршрута» человеку ничего не говорит: точки он выбрал, они на месте,
 * а чего не хватает — непонятно. Здесь называется ровно тот участок, который
 * надо завести в справочнике.
 */
export function missingLeg(legs: RouteLeg[], from: string, via: string[],
                           to: string): string | null {
  const points = [from, ...via, to].map((item) => item.trim()).filter(Boolean)
  for (let index = 0; index < points.length - 1; index += 1) {
    if (pathHours(legs, points[index], points[index + 1]) === null) {
      return `${points[index]} → ${points[index + 1]}`
    }
  }
  return null
}

export type ArrivalResult =
  | { kind: 'written'; text: string; hours: number; fromNow: boolean }
  | {
      kind: 'skip'
      reason: 'нет колонок' | 'нет точек' | 'нет плеча' | 'срок уже стоит'
      /** Для «нет плеча» — участок, которого не хватает: «Кара-Тай → Достук». */
      detail?: string
    }

/**
 * Считает и записывает срок прибытия для строки.
 *
 * Возвращает, что именно произошло: интерфейсу есть что сказать, когда
 * подстановка не сработала — иначе человек не понимает, почему пусто.
 */
export function fillArrival(doc: Y.Doc, sheet: SheetMap, row: number,
                            legs: RouteLeg[]): ArrivalResult {
  if (row <= 0) return { kind: 'skip', reason: 'нет колонок' }

  const fromCol = findColumn(sheet, ROUTE_COLUMNS.from)
  const toCol = findColumn(sheet, ROUTE_COLUMNS.to)
  const arrivalCol = findColumn(sheet, ROUTE_COLUMNS.arrival)
  if (fromCol === null || toCol === null || arrivalCol === null) {
    return { kind: 'skip', reason: 'нет колонок' }
  }

  const from = (readRaw(sheet, row, fromCol) ?? '').trim()
  const to = (readRaw(sheet, row, toCol) ?? '').trim()
  if (!from || !to) return { kind: 'skip', reason: 'нет точек' }

  // Точки по пути учитываются, если для них заведена колонка.
  const viaCol = findColumn(sheet, ROUTE_COLUMNS.via)
  const via = viaCol === null ? [] : parseVia(readRaw(sheet, row, viaCol) ?? '')

  const hours = routeHours(legs, from, via, to)
  if (hours === null) {
    return { kind: 'skip', reason: 'нет плеча', detail: missingLeg(legs, from, via, to) ?? undefined }
  }

  const current = (readRaw(sheet, row, arrivalCol) ?? '').trim()
  if (current) return { kind: 'skip', reason: 'срок уже стоит' }

  const departure = departureMoment(sheet, row,
    findColumn(sheet, ROUTE_COLUMNS.date), findColumn(sheet, ROUTE_COLUMNS.departure))

  // Ни даты, ни времени выезда — значит машина выходит сейчас: запись заводят
  // в тот момент, когда она уезжает. Отказывать здесь нечестно: человек уже
  // выбрал обе точки и ждёт ответа, во сколько груз будет на месте.
  const fromNow = !departure
  const start = departure ?? new Date()

  const arrival = new Date(start.getTime() + hours * 3600 * 1000)
  const text = formatMoment(arrival)
  writeCell(doc, sheet, row, arrivalCol, text)
  return { kind: 'written', text, hours, fromNow }
}

/**
 * Пересчитывает пустые сроки по всей таблице.
 *
 * Журнал обычно заполняют раньше, чем заводят справочник: сначала гоняют
 * машины, потом добираются до настроек. Задним числом ничего не пересчитается
 * само — для этого и нужна кнопка.
 *
 * Возвращает, сколько строк заполнено и сколько пропущено, с причиной самой
 * частой: человеку важно знать, чего не хватает — точек, маршрута или времени.
 */
export function fillAllArrivals(doc: Y.Doc, sheet: SheetMap, legs: RouteLeg[],
                                upTo: number): { filled: number; reasons: Map<string, number> } {
  const reasons = new Map<string, number>()
  let filled = 0

  doc.transact(() => {
    for (let row = 1; row <= upTo; row += 1) {
      const result = fillArrival(doc, sheet, row, legs)
      if (result.kind === 'written') filled += 1
      else reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1)
    }
  })

  return { filled, reasons }
}

/** Правка какой колонки должна запускать пересчёт срока. */
export function affectsArrival(sheet: SheetMap, col: number): boolean {
  return [ROUTE_COLUMNS.from, ROUTE_COLUMNS.to, ROUTE_COLUMNS.via, ROUTE_COLUMNS.date, ROUTE_COLUMNS.departure]
    .some((prefixes) => findColumn(sheet, prefixes) === col)
}

/** Названия точек для выбора в ячейке: то, что заведено в справочнике. */
export function isRoutePointColumn(sheet: SheetMap, col: number): boolean {
  return findColumn(sheet, ROUTE_COLUMNS.from) === col || findColumn(sheet, ROUTE_COLUMNS.to) === col
}

/** Колонка промежуточных точек, если она заведена. */
export function viaColumn(sheet: SheetMap): number | null {
  return findColumn(sheet, ROUTE_COLUMNS.via)
}

// ----------------------------- Точки по пути -----------------------------

/**
 * Отметки о прохождении точек.
 *
 * Рейс идёт Алай → Кара-Тай → Достук, и диспетчеру важно знать не только
 * «приехал», но и «прошёл Кара-Тай»: пока машина в пути, это единственный
 * признак, что она вообще движется.
 *
 * Отметки живут в одной ячейке строки — «Кара-Тай — Асан, 14.09 15:20» через
 * точку с запятой. Отдельных колонок под каждую точку не завести: у каждого
 * рейса они свои.
 */
const CHECKPOINT_SPLIT = /\s*;\s*/

export type Checkpoint = { place: string; note: string }

export function parseCheckpoints(text: string): Checkpoint[] {
  return text
    .split(CHECKPOINT_SPLIT)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const dash = item.indexOf('—')
      return dash === -1
        ? { place: item, note: '' }
        : { place: item.slice(0, dash).trim(), note: item.slice(dash + 1).trim() }
    })
}

export const formatCheckpoints = (items: Checkpoint[]) =>
  items.map((item) => (item.note ? `${item.place} — ${item.note}` : item.place)).join('; ')

/** Все точки маршрута по порядку, кроме той, откуда выехали. */
export function routePoints(sheet: SheetMap, row: number): string[] {
  const toCol = findColumn(sheet, ROUTE_COLUMNS.to)
  const viaCol = findColumn(sheet, ROUTE_COLUMNS.via)
  const via = viaCol === null ? [] : parseVia(readRaw(sheet, row, viaCol) ?? '')
  const to = toCol === null ? '' : (readRaw(sheet, row, toCol) ?? '').trim()
  // Конечную точку, вписанную ещё и в «Через», промежуточной не считаем:
  // иначе кнопка обещала бы «Прошёл Ош», а на деле закрывала рейс.
  const stops = via.filter((point) => placeFold(point) !== placeFold(to))
  return [...stops, to].filter(Boolean)
}

/** Название точки для сравнения: регистр, «ё» и лишние пробелы не важны. */
export const placeFold = (name: string) =>
  name.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).join(' ')

// ------------------------------ Ход рейса ------------------------------

/** Точка маршрута глазами диспетчера: прошли, едем сюда сейчас или впереди. */
export type RouteStop = {
  place: string
  /** Номер точки по порядку: 1 — первая после выезда. */
  order: number
  final: boolean
  state: 'passed' | 'next' | 'ahead'
  /** У пройденной — кто и когда отметил: «Асан, 12.10 15:20». */
  note: string
  /** Когда ждать машину. null — посчитать не из чего. */
  eta: Date | null
}

export type RouteProgress = {
  origin: string
  stops: RouteStop[]
  /** Рейс закрыт: приехал, груз перегружен на другую машину или отменён. */
  closed: 'arrived' | 'transferred' | 'cancelled' | null
}

/** «12.10 15:20» из отметки о прохождении — год берём текущий. */
function stampMoment(note: string, now: Date): Date | null {
  // «12.10 15:20» — как пишет отметка; «12.10.2026 15:20» — если вписали руками.
  const match = /(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\s+(\d{1,2}):(\d{2})/.exec(note)
  if (!match) return null
  const year = match[3] ? Number(match[3]) : now.getFullYear()
  const moment = new Date(year, Number(match[2]) - 1, Number(match[1]),
                          Number(match[4]), Number(match[5]))
  if (match[3]) return moment
  // Отметка из конца декабря, разглядываемая в январе, — прошлогодняя.
  if (moment.getTime() - now.getTime() > 180 * 24 * 3600 * 1000) {
    moment.setFullYear(moment.getFullYear() - 1)
  }
  return moment
}

/**
 * Ход рейса по строке: откуда вышел, какие точки по порядку уже пройдены,
 * куда машина едет сейчас и когда её ждать в каждой следующей.
 *
 * Кнопка «Прибыл» отмечает точки по одной, и без этой картины работники не
 * понимали, что именно она отметит на этот раз. null — в строке нет рейса.
 */
export function routeProgress(sheet: SheetMap, row: number, legs: RouteLeg[],
                              now: Date = new Date()): RouteProgress | null {
  if (row <= 0) return null
  const fromCol = findColumn(sheet, ROUTE_COLUMNS.from)
  const toCol = findColumn(sheet, ROUTE_COLUMNS.to)
  if (fromCol === null || toCol === null) return null

  const origin = (readRaw(sheet, row, fromCol) ?? '').trim()
  const points = routePoints(sheet, row)
  if (!origin || points.length === 0) return null

  const statusCol = findColumn(sheet, ARRIVAL_COLUMNS.status)
  const kind = statusCol === null ? undefined : statusTone(readRaw(sheet, row, statusCol))?.kind
  const closed = kind === 'done' ? 'arrived'
    : kind === 'transferred' ? 'transferred'
      : kind === 'cancelled' ? 'cancelled'
        : null

  const passedCol = findColumn(sheet, ROUTE_COLUMNS.passed)
  const passed = passedCol === null ? [] : parseCheckpoints(readRaw(sheet, row, passedCol) ?? '')
  const passedAt = (place: string) =>
    passed.find((item) => placeFold(item.place) === placeFold(place))

  // Отсчёт времени — от последней пройденной точки, а если таких нет, от выезда.
  let anchorPlace = origin
  let anchor = departureMoment(sheet, row,
    findColumn(sheet, ROUTE_COLUMNS.date), findColumn(sheet, ROUTE_COLUMNS.departure))
  for (const point of points) {
    const item = passedAt(point)
    if (!item) continue
    anchorPlace = point
    anchor = stampMoment(item.note, now) ?? anchor
  }

  const arrivalCol = findColumn(sheet, ROUTE_COLUMNS.arrival)
  const agreed = arrivalCol === null ? null : parseDeadline(readRaw(sheet, row, arrivalCol), now)

  let nextFound = false
  let elapsed = 0
  let previous = anchorPlace

  const stops = points.map((place, index): RouteStop => {
    const final = index === points.length - 1
    const item = passedAt(place)
    const isPassed = Boolean(item) || closed === 'arrived'

    // Без колонки «Пройдено» точки по пути отметить некуда, и «Прибыл»
    // сразу закрывает рейс — значит, следующий шаг здесь конечная точка.
    const markable = final || passedCol !== null

    let state: RouteStop['state'] = 'ahead'
    if (isPassed) state = 'passed'
    else if (!nextFound && !closed && markable) {
      state = 'next'
      nextFound = true
    }

    let eta: Date | null = null
    // У закрытого рейса ждать нечего: он приехал, отменён или груз уже
    // на другой машине.
    if (!isPassed && !closed) {
      const hours = previous && anchor ? pathHours(legs, previous, place) : null
      if (hours === null) {
        previous = ''
      } else {
        elapsed += hours
        eta = new Date((anchor as Date).getTime() + elapsed * 3600 * 1000)
        previous = place
      }
      // Срок в колонке «Прибытие» — договорённость, она важнее норматива.
      if (final && agreed) eta = agreed
    }

    return { place, order: index + 1, final, state, note: item?.note ?? '', eta }
  })

  return { origin, stops, closed }
}

export type CheckpointResult =
  | { kind: 'checkpoint'; place: string; left: string[]; arrival: string | null }
  | { kind: 'final'; place: string }
  | { kind: 'none' }

/**
 * Отмечает прохождение ближайшей неотмеченной точки.
 *
 * Промежуточная точка отмечается и только: рейс продолжается, а срок прибытия
 * пересчитывается от факта — приехал в Кара-Тай в три часа, значит дальше
 * считаем от трёх, а не от времени выезда. Конечная точка ничего не пишет
 * сама: её закрывает обычная приёмка, вместе со статусом и переносом.
 */
export function passCheckpoint(doc: Y.Doc, sheet: SheetMap, row: number,
                               who: string, legs: RouteLeg[]): CheckpointResult {
  // Закрытый рейс точки не проходит — см. isRowClosed.
  if (row <= 0 || isRowClosed(sheet, row)) return { kind: 'none' }

  const points = routePoints(sheet, row)
  if (points.length === 0) return { kind: 'none' }

  const passedCol = findColumn(sheet, ROUTE_COLUMNS.passed)
  const passed = passedCol === null
    ? []
    : parseCheckpoints(readRaw(sheet, row, passedCol) ?? '')
  const seen = new Set(passed.map((item) => placeFold(item.place)))

  const next = points.find((place) => !seen.has(placeFold(place)))
  if (!next) return { kind: 'none' }

  // Последняя точка — это прибытие, его отмечает приёмка.
  if (next === points[points.length - 1]) return { kind: 'final', place: next }
  if (passedCol === null) return { kind: 'final', place: next }

  const now = new Date()
  const stamp = `${two(now.getDate())}.${two(now.getMonth() + 1)} ${two(now.getHours())}:${two(now.getMinutes())}`
  const note = who ? `${who}, ${stamp}` : stamp

  const left = points.slice(points.indexOf(next) + 1)
  let arrival: string | null = null

  doc.transact(() => {
    writeCell(doc, sheet, row, passedCol,
      formatCheckpoints([...passed, { place: next, note }]))

    // Срок до конца пути — от факта прохождения точки.
    const arrivalCol = findColumn(sheet, ROUTE_COLUMNS.arrival)
    const rest = routeHours(legs, next, left.slice(0, -1), left[left.length - 1] ?? '')
    if (arrivalCol !== null && rest !== null) {
      arrival = formatMoment(new Date(now.getTime() + rest * 3600 * 1000))
      writeCell(doc, sheet, row, arrivalCol, arrival)
    }
  })

  return { kind: 'checkpoint', place: next, left, arrival }
}
