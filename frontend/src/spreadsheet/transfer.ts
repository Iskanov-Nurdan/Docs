/**
 * Перегруз: груз переложили с одной машины на другую по дороге.
 *
 * Пример: машина вышла с Алая на Ош, в Кара-Тае груз целиком переложили на
 * другую машину. Строка остаётся та же — в ней меняется машина, водитель,
 * телефон и срок, а старая машина и место перегруза пишутся в примечание.
 * Новых строк не появляется: в таблице на сотню рейсов перегруз не сдвигает
 * остальные и не увеличивает их число, а деньги груза не задваиваются.
 *
 * Раньше перегруз заводил новую строку со статусом «Перегружен» у старой и
 * общим номером в колонке «Груз №». Такие строки в книгах остались, поэтому
 * приёмка (`moveCargoChain`) по-прежнему уносит цепочку целиком.
 */
import type * as Y from 'yjs'
import type { RouteLeg } from '@/types'
import {
  ARRIVAL_COLUMNS,
  VEHICLE_COLUMNS,
  findColumn,
  lastFilledRow,
  moveRowToSheet,
  readRaw,
  writeCell,
  type SheetMap,
} from './model'
import {
  ROUTE_COLUMNS, formatMoment, parseCheckpoints, parseVia, routeHours,
} from './routing'
import { statusTone } from './statuses'

/** Колонка номера груза — по ней связаны плечи одного груза. */
export const CARGO_ID_COLUMNS = ['груз №', '№ груза', 'номер груза', 'накладн', 'cargo no', 'cargo id', '货号', '运单']

export const DRIVER_COLUMNS = ['водител', 'шофер', 'шофёр', 'айдоочу', 'driver', '司机']
/** Телефон водителя — у новой машины свой, его спрашивает окно перегруза. */
export const DRIVER_PHONE_COLUMNS = ['телефон водител', 'тел водител', 'тел. водител', 'телефон',
                                     'тел.', 'тел ', 'phone', '电话']
const NOTE_COLUMNS = ['примечан', 'комментар', 'эскертүү', 'note', 'comment', '备注']

const two = (value: number) => String(value).padStart(2, '0')
const sameplace = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/ё/g, 'е') === b.trim().toLowerCase().replace(/ё/g, 'е')

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
  | { kind: 'done'; row: number; arrival: string | null }
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
 * Перегружает груз из строки `row` на новую машину — прямо в той же строке.
 *
 * Новой строки не появляется: таблица не растёт и рейсы ниже не съезжают.
 * Меняется машина, водитель, телефон и срок, а старая машина и место
 * перегруза остаются в примечании. Деньги не трогаются — груз один, строка
 * одна. Всё одной транзакцией: Ctrl+Z отменяет перегруз целиком.
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
    to: findColumn(sheet, ROUTE_COLUMNS.to) as number,
    via: findColumn(sheet, ROUTE_COLUMNS.via),
    arrival: findColumn(sheet, ROUTE_COLUMNS.arrival),
    driver: findColumn(sheet, DRIVER_COLUMNS),
    phone: findColumn(sheet, DRIVER_PHONE_COLUMNS),
    note: findColumn(sheet, NOTE_COLUMNS),
    status: findColumn(sheet, ARRIVAL_COLUMNS.status),
  }

  const to = (readRaw(sheet, row, col.to) ?? '').trim()
  if (sameplace(place, to)) {
    return {
      kind: 'error',
      message: `${to} — конечная точка. Если машина туда доехала, нажмите «Прибыл».`,
    }
  }

  const oldVehicle = (readRaw(sheet, row, col.vehicle) ?? '').trim()

  // Срок новой машины считается от места перегруза по оставшимся точкам.
  // Если места перегруза в списке нет, путь дальше неизвестен — напрямую.
  const via = col.via === null ? [] : parseVia(readRaw(sheet, row, col.via) ?? '')
  const at = via.findIndex((point) => sameplace(point, place))
  const viaAfter = at === -1 ? [] : via.slice(at + 1)

  const now = new Date()
  const stamp = `${two(now.getDate())}.${two(now.getMonth() + 1)}.${now.getFullYear()}`
    + ` ${two(now.getHours())}:${two(now.getMinutes())}`

  let arrival: string | null = null

  doc.transact(() => {
    writeCell(doc, sheet, row, col.vehicle, vehicle)
    // Водитель и телефон у новой машины свои: старые оставлять нельзя —
    // по ним звонили бы не тому человеку. Пусто в окне — пусто в ячейке.
    if (col.driver !== null) writeCell(doc, sheet, row, col.driver, input.driver.trim())
    if (col.phone !== null) writeCell(doc, sheet, row, col.phone, input.phone.trim())
    if (col.status !== null) writeCell(doc, sheet, row, col.status, 'В пути')

    const hours = routeHours(input.legs, place, viaAfter, to)
    if (col.arrival !== null && hours !== null) {
      arrival = formatMoment(new Date(now.getTime() + hours * 3600 * 1000))
      writeCell(doc, sheet, row, col.arrival, arrival)
    }

    if (col.note !== null) {
      const note = (readRaw(sheet, row, col.note) ?? '').trim()
      const mark = `Перегруз в ${place}${oldVehicle ? ` с ${oldVehicle}` : ''} на ${vehicle}`
        + ` (${stamp}${input.who ? `, ${input.who}` : ''})`
      writeCell(doc, sheet, row, col.note, note ? `${note}; ${mark}` : mark)
    }
  })

  return { kind: 'done', row, arrival }
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
