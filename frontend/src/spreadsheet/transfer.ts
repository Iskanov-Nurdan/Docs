/**
 * Перегруз: груз переложили с одной машины на другую по дороге.
 *
 * Пример: машина вышла с Алая на Ош, в Кара-Тае груз целиком переложили на
 * другую машину. Формально первая машина до конечной точки не дошла, поэтому
 * её строка не «Прибыл», а «Перегружен»: её плечо закончилось в Кара-Тае.
 * Груз дальше едет новой строкой — уже на второй машине, из Кара-Тая в Ош.
 *
 * Обе строки связаны номером груза («Г-0042») в колонке «Груз №»: по нему
 * видна вся цепочка, а когда последняя машина приезжает, в «Груз доставлен»
 * уходит вся цепочка разом.
 *
 * Деньги не переносятся: стоимость груза и налог остаются в первой строке,
 * а расход на перевозку у каждой машины свой. Иначе сводка бухгалтера
 * посчитала бы один груз дважды. Поэтому во вторую строку уходит только
 * текст — груз, клиент, примечания, — а числа и формулы нет: колонку с
 * деньгами по названию узнать можно не всегда («Общая стоимость», «Пошлина»),
 * а число в чужой колонке задвоило бы и итог под таблицей.
 */
import type * as Y from 'yjs'
import type { RouteLeg } from '@/types'
import {
  ARRIVAL_COLUMNS,
  VEHICLE_COLUMNS,
  book,
  colCount,
  findColumn,
  growCols,
  insertRow,
  lastFilledRow,
  moveRowToSheet,
  readRaw,
  writeCell,
  type SheetMap,
} from './model'
import { isMoneyColumn, parseAmount } from './money'
import {
  ROUTE_COLUMNS, formatMoment, formatVia, parseCheckpoints, parseVia, routeHours,
} from './routing'
import { TRANSFERRED, statusTone } from './statuses'

/** Колонка номера груза — по ней связаны плечи одного груза. */
export const CARGO_ID_COLUMNS = ['груз №', '№ груза', 'номер груза', 'накладн', 'cargo no', 'cargo id', '货号', '运单']
const CARGO_ID_HEADER = 'Груз №'

export const DRIVER_COLUMNS = ['водител', 'шофер', 'шофёр', 'айдоочу', 'driver', '司机']
/** Телефон водителя — у новой машины свой, его спрашивает окно перегруза. */
export const DRIVER_PHONE_COLUMNS = ['телефон водител', 'тел водител', 'тел. водител', 'телефон',
                                     'тел.', 'тел ', 'phone', '电话']
/**
 * Колонки, которые относятся к машине, а не к грузу: вторая машина и её
 * телефон. Новой машине они не переходят.
 */
const VEHICLE_OWN_COLUMNS = ['втор', 'телефон', 'тел.', 'тел ', 'phone', '电话']
const NOTE_COLUMNS = ['примечан', 'комментар', 'эскертүү', 'note', 'comment', '备注']

const two = (value: number) => String(value).padStart(2, '0')
const sameplace = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/ё/g, 'е') === b.trim().toLowerCase().replace(/ё/g, 'е')

/** Номер груза: «Г-0042-7K». Хвост после второго дефиса — метка компьютера. */
const CARGO_ID = /^Г-(\d+)(?:-[0-9A-Z]+)?$/

/**
 * Следующий номер груза.
 *
 * Номер считается по своей копии книги, а двое могут перегружать в одну и ту
 * же секунду — и оба насчитали бы «Г-0042». Тогда при приёмке одного груза в
 * «Груз доставлен» уехало бы плечо чужого. Поэтому к номеру добавляется метка
 * компьютера (из идентификатора участника Yjs): у двоих она разная.
 *
 * Просматриваются все листы и все колонки: на листе «Груз доставлен» колонка
 * могла называться иначе, а номер, выданный раньше, выдавать снова нельзя.
 */
function nextCargoId(doc: Y.Doc): string {
  let highest = 0
  for (const sheet of book(doc).toArray()) {
    const last = lastFilledRow(sheet)
    const total = colCount(sheet)
    for (let row = 1; row <= last; row += 1) {
      for (let col = 0; col < total; col += 1) {
        const match = CARGO_ID.exec((readRaw(sheet, row, col) ?? '').trim())
        if (match) highest = Math.max(highest, Number(match[1]))
      }
    }
  }
  const mark = (doc.clientID % 1296).toString(36).toUpperCase().padStart(2, '0')
  return `Г-${String(highest + 1).padStart(4, '0')}-${mark}`
}

/**
 * Колонка «Груз №». Если её нет — заводится справа от последней колонки шапки.
 *
 * На листе «Груз доставлен» шапка заводится в том же месте: строки переезжают
 * туда по номеру столбца, и без шапки номер груза лежал бы там безымянным.
 */
function cargoIdColumn(doc: Y.Doc, sheet: SheetMap, deliveredSheet: string): number {
  const existing = findColumn(sheet, CARGO_ID_COLUMNS)
  if (existing !== null) return existing

  // Строки переезжают на «Груз доставлен» по номеру столбца, поэтому место
  // должно быть свободно на обоих листах: иначе номер груза лёг бы там в
  // чужую колонку («Оплачено бухгалтером»).
  const delivered = book(doc).toArray().find((item) => String(item.get('name')) === deliveredSheet)
  const lastHeader = (target: SheetMap) => {
    let last = -1
    const total = colCount(target)
    for (let col = 0; col < total; col += 1) {
      if ((readRaw(target, 0, col) ?? '').trim()) last = col
    }
    return last
  }
  const col = Math.max(lastHeader(sheet), delivered && delivered !== sheet ? lastHeader(delivered) : -1) + 1
  if (col >= colCount(sheet)) growCols(doc, sheet, col + 1 - colCount(sheet))
  writeCell(doc, sheet, 0, col, CARGO_ID_HEADER)

  if (delivered && delivered !== sheet) {
    if (col >= colCount(delivered)) growCols(doc, delivered, col + 1 - colCount(delivered))
    writeCell(doc, delivered, 0, col, CARGO_ID_HEADER)
  }
  return col
}

export type TransferInput = {
  /** Где перегрузили: «Кара-Тай». */
  place: string
  /** Номер новой машины. */
  vehicle: string
  /** Водитель новой машины. Пусто — колонка останется пустой. */
  driver: string
  /** Телефон водителя новой машины. Пусто — колонка останется пустой. */
  phone: string
  /** Кто отметил перегруз — пишется в «Принял». */
  who: string
  legs: RouteLeg[]
  /** Лист доставленных — на нём тоже нужна колонка «Груз №». */
  deliveredSheet: string
}

export type TransferResult =
  | { kind: 'done'; row: number; cargoId: string; arrival: string | null; created: boolean }
  | { kind: 'error'; message: string }

/** Что мешает перегрузу в этой строке. null — можно перегружать. */
export function transferBlocker(sheet: SheetMap, row: number): string | null {
  if (row <= 0) return 'Встаньте на строку рейса — шапку перегрузить нельзя.'
  if (findColumn(sheet, VEHICLE_COLUMNS) === null) {
    return 'Нет колонки «Машина» — некуда записать новую машину.'
  }
  const from = findColumn(sheet, ROUTE_COLUMNS.from)
  const to = findColumn(sheet, ROUTE_COLUMNS.to)
  if (from === null || to === null) return 'Для перегруза нужны колонки «Откуда» и «Куда».'
  if (!(readRaw(sheet, row, to) ?? '').trim()) return 'В строке не заполнено «Куда».'

  // Без статуса перегруженную строку нечем закрыть: её можно было бы
  // перегрузить второй раз, срок продолжал бы краснеть, а цепочка при
  // приёмке не собралась бы.
  const status = findColumn(sheet, ARRIVAL_COLUMNS.status)
  if (status === null) return 'Для перегруза нужна колонка «Статус» — по ней строка закрывается.'
  const kind = statusTone(readRaw(sheet, row, status))?.kind
  if (kind === 'transferred') return 'Груз из этой строки уже перегружен — отмечайте строку новой машины.'
  if (kind === 'done' || kind === 'cancelled') return 'Рейс в этой строке уже закрыт.'

  const other = activeLegOfSameCargo(sheet, row)
  if (other !== null) {
    return `У этого груза уже есть машина в пути — строка ${other + 1}. Перегружайте с неё.`
  }
  return null
}

/**
 * Другая незакрытая строка того же груза. null — такой нет.
 *
 * Груз едет на одной машине. Если строк «в пути» с его номером две, значит,
 * перегруз уже сделали — возможно, с другого компьютера одновременно с этим.
 */
export function activeLegOfSameCargo(sheet: SheetMap, row: number): number | null {
  const idCol = findColumn(sheet, CARGO_ID_COLUMNS)
  const status = findColumn(sheet, ARRIVAL_COLUMNS.status)
  if (idCol === null || status === null) return null
  const cargoId = (readRaw(sheet, row, idCol) ?? '').trim()
  if (!cargoId) return null

  const last = lastFilledRow(sheet)
  for (let index = 1; index <= last; index += 1) {
    if (index === row || (readRaw(sheet, index, idCol) ?? '').trim() !== cargoId) continue
    const kind = statusTone(readRaw(sheet, index, status))?.kind
    if (kind !== 'transferred' && kind !== 'done' && kind !== 'cancelled') return index
  }
  return null
}

/**
 * Где, скорее всего, перегрузили: последняя пройденная точка, потом
 * остальные точки по пути. Обычно сначала отмечают «прошли Кара-Тай», а уже
 * там груз перекладывают — поэтому пройденная идёт первой.
 */
export function transferPlaces(sheet: SheetMap, row: number): string[] {
  const viaCol = findColumn(sheet, ROUTE_COLUMNS.via)
  const passedCol = findColumn(sheet, ROUTE_COLUMNS.passed)
  const via = viaCol === null ? [] : parseVia(readRaw(sheet, row, viaCol) ?? '')
  const passed = passedCol === null
    ? []
    : parseCheckpoints(readRaw(sheet, row, passedCol) ?? '').map((item) => item.place)
  return Array.from(new Set([...passed.reverse(), ...via]))
}

/**
 * Перегружает груз из строки `row` на новую машину.
 *
 * Новая строка встаёт сразу под старой — цепочку видно глазами. Всё делается
 * одной транзакцией: Ctrl+Z отменяет перегруз целиком.
 */
export function transferCargo(doc: Y.Doc, sheet: SheetMap, row: number,
                              input: TransferInput): TransferResult {
  const blocker = transferBlocker(sheet, row)
  if (blocker) return { kind: 'error', message: blocker }

  const place = input.place.trim()
  const vehicle = input.vehicle.trim()
  if (!place) return { kind: 'error', message: 'Укажите, где перегрузили.' }
  if (!vehicle) return { kind: 'error', message: 'Укажите номер новой машины.' }

  const col = {
    vehicle: findColumn(sheet, VEHICLE_COLUMNS) as number,
    from: findColumn(sheet, ROUTE_COLUMNS.from) as number,
    to: findColumn(sheet, ROUTE_COLUMNS.to) as number,
    via: findColumn(sheet, ROUTE_COLUMNS.via),
    date: findColumn(sheet, ROUTE_COLUMNS.date),
    departure: findColumn(sheet, ROUTE_COLUMNS.departure),
    arrival: findColumn(sheet, ROUTE_COLUMNS.arrival),
    passed: findColumn(sheet, ROUTE_COLUMNS.passed),
    driver: findColumn(sheet, DRIVER_COLUMNS),
    phone: findColumn(sheet, DRIVER_PHONE_COLUMNS),
    note: findColumn(sheet, NOTE_COLUMNS),
    status: findColumn(sheet, ARRIVAL_COLUMNS.status),
    acceptedBy: findColumn(sheet, ARRIVAL_COLUMNS.acceptedBy),
    acceptedAt: findColumn(sheet, ARRIVAL_COLUMNS.acceptedAt),
  }

  const to = (readRaw(sheet, row, col.to) ?? '').trim()
  if (sameplace(place, to)) {
    return {
      kind: 'error',
      message: `${to} — конечная точка. Если машина туда доехала, нажмите «Прибыл».`,
    }
  }

  const oldVehicle = (readRaw(sheet, row, col.vehicle) ?? '').trim()

  // Точки по пути делятся: до места перегруза они остаются первой машине,
  // после — уходят второй. Если места перегруза в списке нет, второй машине
  // путь неизвестен, и она едет напрямую.
  const via = col.via === null ? [] : parseVia(readRaw(sheet, row, col.via) ?? '')
  const at = via.findIndex((point) => sameplace(point, place))
  const viaBefore = at === -1 ? via : via.slice(0, at)
  const viaAfter = at === -1 ? [] : via.slice(at + 1)

  // Эти колонки у новой машины свои; остальное (груз, клиент) — то же.
  const own = new Set(
    [col.vehicle, col.from, col.to, col.via, col.date, col.departure, col.arrival,
     col.passed, col.driver, col.phone, col.note, col.status, col.acceptedBy, col.acceptedAt]
      .filter((value): value is number => value !== null),
  )
  const headers = colCount(sheet)
  for (let index = 0; index < headers; index += 1) {
    const header = (readRaw(sheet, 0, index) ?? '').trim().toLowerCase()
    if (VEHICLE_OWN_COLUMNS.some((prefix) => header.startsWith(prefix))) own.add(index)
  }

  const now = new Date()
  const today = `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()}`
  const time = `${two(now.getHours())}:${two(now.getMinutes())}`
  const stamp = `${today} ${time}`

  let cargoId = ''
  let created = false
  let arrival: string | null = null
  const target = row + 1

  doc.transact(() => {
    const idCol = cargoIdColumn(doc, sheet, input.deliveredSheet)
    own.add(idCol)
    cargoId = (readRaw(sheet, row, idCol) ?? '').trim()
    if (!cargoId) {
      cargoId = nextCargoId(doc)
      created = true
      writeCell(doc, sheet, row, idCol, cargoId)
    }

    insertRow(doc, sheet, target)

    // Переезжает только текст: груз, клиент. Числа и формулы остаются у
    // первой машины — деньги и вес принадлежат грузу один раз, иначе они
    // задвоились бы и в итоге под таблицей, и в сводке бухгалтера.
    const total = colCount(sheet)
    for (let index = 0; index < total; index += 1) {
      const raw = readRaw(sheet, row, index)
      if (raw === null || raw.trim() === '') continue
      if (own.has(index) || isMoneyColumn(sheet, index)) continue
      if (raw.startsWith('=') || parseAmount(raw) !== null) continue
      writeCell(doc, sheet, target, index, raw)
    }

    // Новая машина: из места перегруза в ту же конечную точку.
    writeCell(doc, sheet, target, idCol, cargoId)
    writeCell(doc, sheet, target, col.vehicle, vehicle)
    if (col.driver !== null && input.driver.trim()) {
      writeCell(doc, sheet, target, col.driver, input.driver.trim())
    }
    if (col.phone !== null && input.phone.trim()) {
      writeCell(doc, sheet, target, col.phone, input.phone.trim())
    }
    writeCell(doc, sheet, target, col.from, place)
    writeCell(doc, sheet, target, col.to, to)
    if (col.via !== null && viaAfter.length > 0) {
      writeCell(doc, sheet, target, col.via, formatVia(viaAfter))
    }
    if (col.date !== null) writeCell(doc, sheet, target, col.date, today)
    if (col.departure !== null) writeCell(doc, sheet, target, col.departure, time)
    if (col.status !== null) writeCell(doc, sheet, target, col.status, 'В пути')
    if (col.note !== null) {
      writeCell(doc, sheet, target, col.note,
        `Перегруз в ${place}${oldVehicle ? ` с ${oldVehicle}` : ''}`)
    }

    // Срок новой машины — от момента перегруза по справочнику маршрутов.
    const hours = routeHours(input.legs, place, viaAfter, to)
    if (col.arrival !== null && hours !== null) {
      arrival = formatMoment(new Date(now.getTime() + hours * 3600 * 1000))
      writeCell(doc, sheet, target, col.arrival, arrival)
    }

    // Старая машина: её плечо закончилось в месте перегруза.
    writeCell(doc, sheet, row, col.to, place)
    if (col.via !== null) writeCell(doc, sheet, row, col.via, formatVia(viaBefore))
    if (col.status !== null) writeCell(doc, sheet, row, col.status, TRANSFERRED.label)
    if (col.acceptedBy !== null && input.who) writeCell(doc, sheet, row, col.acceptedBy, input.who)
    if (col.acceptedAt !== null) writeCell(doc, sheet, row, col.acceptedAt, stamp)
    if (col.note !== null) {
      const note = (readRaw(sheet, row, col.note) ?? '').trim()
      const mark = `Перегружен в ${place} на ${vehicle} (${stamp}), едет дальше в ${to}`
      writeCell(doc, sheet, row, col.note, note ? `${note}; ${mark}` : mark)
    }
  })

  return { kind: 'done', row: target, cargoId, arrival, created }
}

/** Это плечо закрыто перегрузом — «Прибыл» на нём не отмечают. */
export function isTransferred(sheet: SheetMap, row: number): boolean {
  const status = findColumn(sheet, ARRIVAL_COLUMNS.status)
  return status !== null && statusTone(readRaw(sheet, row, status))?.kind === 'transferred'
}

/**
 * Переносит на лист доставленных всю цепочку груза: строку, которую приняли,
 * и перегруженные плечи с тем же номером груза.
 *
 * Плечи идут по порядку сверху вниз, чтобы и на новом листе цепочка читалась
 * от первой машины к последней. Возвращает строку принятой машины на новом
 * листе и сколько плеч переехало вместе с ней.
 */
export function moveCargoChain(doc: Y.Doc, sheet: SheetMap, row: number,
                               sheetName: string): { landed: number; legs: number } {
  const idCol = findColumn(sheet, CARGO_ID_COLUMNS)
  const cargoId = idCol === null ? '' : (readRaw(sheet, row, idCol) ?? '').trim()

  const chain = [row]
  if (idCol !== null && cargoId) {
    const last = lastFilledRow(sheet)
    for (let index = 1; index <= last; index += 1) {
      if (index === row) continue
      if ((readRaw(sheet, index, idCol) ?? '').trim() !== cargoId) continue
      // Только плечи ДО этой машины: перегруженные строки выше неё. Строка
      // с тем же номером ниже — чужая или ошибочная, её не трогаем.
      if (index < row && isTransferred(sheet, index)) chain.push(index)
    }
  }
  chain.sort((a, b) => a - b)

  let landed = -1
  doc.transact(() => {
    // Каждый перенос удаляет строку, и строки ниже поднимаются на одну.
    chain.forEach((index, moved) => {
      const at = moveRowToSheet(doc, sheet, index - moved, sheetName)
      if (index === row) landed = at
    })
  })
  return { landed, legs: chain.length - 1 }
}
