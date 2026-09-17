/**
 * Книга поверх Yjs.
 *
 * Каждая ячейка — отдельная Y.Map, а не поле в общем объекте. Так двое,
 * правящих соседние ячейки (или значение и его цвет в одной), не спорят за
 * одну запись: CRDT сливает их изменения независимо.
 *
 * Хранятся только заполненные ячейки. Пустая сетка не занимает ничего,
 * поэтому лист может быть сколь угодно большим.
 */
import * as Y from 'yjs'
import {
  Evaluator, MAX_COLS, MAX_ROWS, cellRef, colIndex, colLabel, parseRef,
  type CellValue,
} from './formula'
// Отбор по промежутку сравнивает и время: «до среды» — это тот же разбор
// срока, что красит просрочку.
import { parseDeadline } from './statuses'

export const ROW_HEIGHT = 24
export const DEFAULT_COL_WIDTH = 100
export const MIN_COL_WIDTH = 40
export const HEADER_WIDTH = 46
export const DEFAULT_ROWS = 200
export const DEFAULT_COLS = 26

// Границы листа объявлены рядом с разбором адресов: проверять «A100000000»
// нужно там, где адрес читается, а не там, где рисуется сетка.
export { MAX_COLS, MAX_ROWS }

// 'currency' — рубль. Значение оставлено прежним намеренно: им уже размечены
// набранные таблицы, и переименование стёрло бы формат в каждой из них.
export type NumberFormat =
  | 'auto'
  | 'number'
  | 'percent'
  | 'currency'
  | 'currency_kgs'
  | 'currency_cny'
  | 'currency_usd'
  | 'date'
  | 'text'
export type Align = 'left' | 'center' | 'right'

export type CellStyle = {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  align?: Align
  color?: string
  background?: string
  format?: NumberFormat
}

/** Ключи в Y.Map держим короткими: они уходят в каждое приращение по сети. */
const KEYS = {
  raw: 'v',
  bold: 'b',
  italic: 'i',
  underline: 'u',
  align: 'a',
  color: 'c',
  background: 'g',
  format: 'f',
} as const

export type SheetMap = Y.Map<unknown>
export type CellMap = Y.Map<unknown>

export type SheetInfo = {
  id: string
  name: string
}

const newId = () => Math.random().toString(36).slice(2, 10)

/**
 * Идентификатор строки. Буква впереди не украшение: у листа, сохранённого до
 * появления идентификаторов, строка опознаётся по своему номеру («41»), и
 * префикс гарантирует, что новая строка никогда не займёт чужое имя.
 */
const newRowId = () => `r${Math.random().toString(36).slice(2, 10)}`

// ------------------------------- Структура -------------------------------

export function book(doc: Y.Doc): Y.Array<SheetMap> {
  return doc.getArray<SheetMap>('sheets')
}

function rowIds(count: number): Y.Array<string> {
  const rows = new Y.Array<string>()
  rows.push(Array.from({ length: count }, newRowId))
  return rows
}

function makeSheet(name: string): SheetMap {
  const sheet = new Y.Map<unknown>()
  sheet.set('id', newId())
  sheet.set('name', name)
  sheet.set('cells', new Y.Map<CellMap>())
  sheet.set('cols', new Y.Map<number>())
  sheet.set('rows', rowIds(DEFAULT_ROWS))
  sheet.set('colCount', DEFAULT_COLS)
  return sheet
}

/**
 * Порядок строк листа.
 *
 * Ключ ячейки — «идентификатор строки:столбец», а не «номер:столбец». Разница
 * решающая: вставка строки теперь сдвигает один элемент этого списка, а не
 * переписывает ключи всех ячеек листа. Раньше вставка стирала карту ячеек
 * целиком и пересоздавала её, поэтому правка соседа, пришедшая в тот же
 * момент, применялась к уже удалённой ячейке и пропадала без следа.
 *
 * null — лист старого формата, где номер строки и есть её идентификатор.
 * Такой лист доводится до нового формата в ensureBook.
 */
function rowsArray(sheet: SheetMap): Y.Array<string> | null {
  const rows = sheet.get('rows')
  return rows instanceof Y.Array ? (rows as Y.Array<string>) : null
}

/** Идентификатор строки по её номеру. null — такой строки на листе нет. */
function rowIdAt(sheet: SheetMap, index: number): string | null {
  if (!Number.isInteger(index) || index < 0) return null
  const rows = rowsArray(sheet)
  if (!rows) return index < MAX_ROWS ? String(index) : null
  return index < rows.length ? rows.get(index) : null
}

/**
 * Номера строк по идентификаторам — для обхода карты ячеек.
 *
 * null означает лист старого формата: там идентификатор и есть номер.
 */
function rowOrder(sheet: SheetMap): Map<string, number> | null {
  const rows = rowsArray(sheet)
  if (!rows) return null
  const order = new Map<string, number>()
  rows.toArray().forEach((id, at) => order.set(id, at))
  return order
}

/** Разбирает ключ ячейки. null — ключ битый или строка уже удалена. */
function parseKey(mapKey: string, order: Map<string, number> | null):
    { row: number; col: number } | null {
  const at = mapKey.indexOf(':')
  if (at === -1) return null

  const id = mapKey.slice(0, at)
  const col = Number(mapKey.slice(at + 1))
  if (!Number.isInteger(col) || col < 0) return null

  const row = order ? order.get(id) : Number(id)
  if (row === undefined || !Number.isInteger(row) || row < 0) return null
  return { row, col }
}

/**
 * Доводит лист до формата с идентификаторами строк.
 *
 * Ячейки при этом не двигаются: у листа старого формата ключ начинается с
 * номера строки, и этот же номер становится её идентификатором. Поэтому
 * перенос — это создание списка «0, 1, 2, …», а не перекладывание данных.
 */
function ensureRows(doc: Y.Doc, sheet: SheetMap): void {
  if (rowsArray(sheet)) return

  // Ячейки могли уехать за объявленное число строк — вставка из буфера
  // раньше писала мимо него. Такие строки тоже должны попасть в список,
  // иначе их содержимое осталось бы недостижимым.
  let highest = Number(sheet.get('rowCount') ?? DEFAULT_ROWS)
  if (!Number.isFinite(highest)) highest = DEFAULT_ROWS

  const cells = sheet.get('cells') as Y.Map<CellMap> | undefined
  cells?.forEach((_cell, mapKey) => {
    const row = Number(mapKey.slice(0, mapKey.indexOf(':')))
    if (Number.isInteger(row) && row + 1 > highest) highest = row + 1
  })

  const count = Math.min(Math.max(Math.trunc(highest), DEFAULT_ROWS), MAX_ROWS)

  doc.transact(() => {
    if (rowsArray(sheet)) return
    const rows = new Y.Array<string>()
    sheet.set('rows', rows)
    rows.push(Array.from({ length: count }, (_value, at) => String(at)))
  })
}

/** Первый лист создаём на месте: пустая книга нигде не показывается. */
export function ensureBook(doc: Y.Doc): void {
  const sheets = book(doc)
  if (sheets.length === 0) {
    doc.transact(() => sheets.push([makeSheet('Лист1')]))
  }
  for (const sheet of sheets.toArray()) ensureRows(doc, sheet)
}

/** Пуста ли книга: ни одной заполненной ячейки ни на одном листе. */
export function isBookEmpty(doc: Y.Doc): boolean {
  return book(doc)
    .toArray()
    .every((sheet) => cellsOf(sheet).size === 0)
}

/**
 * Переносит сохранённую книгу в документ Yjs.
 *
 * Содержимое документа лежит в базе обычным JSON — им создаётся таблица из
 * шаблона и им же заполняется книга после переноса из файла. Но редактор
 * читает не его, а состояние Yjs, и без этого переноса таблица открывалась бы
 * пустой: заголовки есть в базе, а на экране их нет.
 *
 * Сеять можно только в пустую книгу: у CRDT нет понятия «заменить», и повтор
 * лёг бы поверх уже набранного вторым слоем.
 */
export function seedBook(doc: Y.Doc, content: unknown): boolean {
  if (!content || typeof content !== 'object') return false
  const source = content as { kind?: string; sheets?: unknown }
  if (source.kind !== 'sheet' || !Array.isArray(source.sheets)) return false
  if (!isBookEmpty(doc)) return false

  const sheets = source.sheets as Array<{ name?: string; cells?: Record<string, unknown> }>
  if (sheets.length === 0) return false

  doc.transact(() => {
    const target = book(doc)
    // Пустые листы, созданные при открытии, книге из шаблона только мешают.
    if (target.length > 0) target.delete(0, target.length)

    for (const item of sheets) {
      const sheet = makeSheet(String(item.name ?? 'Лист1').slice(0, 50))
      target.push([sheet])
      fillSheet(doc, sheet, item.cells ?? {})
    }
  })
  return true
}

/** Сохранённые ячейки {адрес: {value, display}} — в лист. */
function fillSheet(doc: Y.Doc, sheet: SheetMap, source: Record<string, unknown>): void {
  const cells = cellsOf(sheet)
  for (const [ref, raw] of Object.entries(source)) {
    const address = parseRef(ref)
    // Адрес за пределами листа пропускаем молча: содержимое приходит из базы
    // или из файла, и падать на одной кривой ячейке нельзя.
    if (!address) continue
    if (address.row >= MAX_ROWS || address.col >= MAX_COLS) continue

    // Ячейка — это {value, display}: value введено человеком, display
    // посчитан. Формулы пересчитает редактор, поэтому берём value.
    const value =
      raw && typeof raw === 'object'
        ? (raw as { value?: unknown }).value
        : raw
    if (value === undefined || value === null || value === '') continue

    const mapKey = keyForWrite(doc, sheet, address.row, address.col)
    if (mapKey === null) continue

    const cell = new Y.Map<unknown>()
    cell.set(KEYS.raw, String(value))
    cells.set(mapKey, cell)
  }
}

/**
 * Листы из файла — в открытую книгу. Возвращает номер первого из них.
 *
 * Пустая книга заменяется целиком: пустой «Лист1» рядом с перенесёнными
 * данными только сбивал бы с толку. В заполненную книгу листы добавляются
 * рядом — затирать то, что уже набрано (в том числе соседями по документу),
 * импорт не вправе.
 */
export function importSheets(
  doc: Y.Doc,
  sheets: Array<{ name: string; cells: Record<string, unknown> }>,
): number {
  if (sheets.length === 0) return -1
  if (isBookEmpty(doc) && seedBook(doc, { kind: 'sheet', sheets })) {
    ensureBook(doc)
    return 0
  }

  const target = book(doc)
  const first = target.length
  doc.transact(() => {
    for (const item of sheets) {
      const sheet = makeSheet(uniqueSheetName(doc, item.name || 'Лист'))
      target.push([sheet])
      fillSheet(doc, sheet, item.cells)
    }
  })
  return first
}

/** «Рейсы», а если такой лист уже есть — «Рейсы (2)». */
function uniqueSheetName(doc: Y.Doc, wanted: string): string {
  const used = new Set(book(doc).toArray().map((sheet) => String(sheet.get('name'))))
  const base = wanted.trim().slice(0, 44) || 'Лист'
  if (!used.has(base)) return base

  let number = 2
  while (used.has(`${base} (${number})`)) number += 1
  return `${base} (${number})`
}

export function sheetList(doc: Y.Doc): SheetInfo[] {
  return book(doc)
    .toArray()
    .map((sheet) => ({
      id: String(sheet.get('id') ?? ''),
      name: String(sheet.get('name') ?? 'Лист'),
    }))
}

export function sheetAt(doc: Y.Doc, index: number): SheetMap | null {
  const sheets = book(doc)
  if (index < 0 || index >= sheets.length) return null
  return sheets.get(index)
}

export function addSheet(doc: Y.Doc): number {
  const sheets = book(doc)
  const used = new Set(sheets.toArray().map((sheet) => String(sheet.get('name'))))

  let number = sheets.length + 1
  while (used.has(`Лист${number}`)) number += 1

  doc.transact(() => sheets.push([makeSheet(`Лист${number}`)]))
  return sheets.length - 1
}

export function renameSheet(doc: Y.Doc, index: number, name: string): void {
  const sheet = sheetAt(doc, index)
  if (!sheet) return
  const trimmed = name.trim().slice(0, 50)
  if (!trimmed) return
  doc.transact(() => sheet.set('name', trimmed))
}

/** Последний лист не удаляем: книга без листов не имеет представления. */
export function removeSheet(doc: Y.Doc, index: number): void {
  const sheets = book(doc)
  if (sheets.length <= 1 || index < 0 || index >= sheets.length) return
  doc.transact(() => sheets.delete(index, 1))
}

// -------------------------------- Ячейки --------------------------------

function cellsOf(sheet: SheetMap): Y.Map<CellMap> {
  return sheet.get('cells') as Y.Map<CellMap>
}

const key = (rowId: string, col: number) => `${rowId}:${col}`

/** Ключ ячейки по её номеру строки. null — строки на листе нет. */
function keyAt(sheet: SheetMap, row: number, col: number): string | null {
  if (!Number.isInteger(col) || col < 0 || col >= MAX_COLS) return null
  const id = rowIdAt(sheet, row)
  return id === null ? null : key(id, col)
}

export function rowCount(sheet: SheetMap): number {
  const rows = rowsArray(sheet)
  if (rows) return rows.length
  const stored = Number(sheet.get('rowCount') ?? DEFAULT_ROWS)
  return Number.isFinite(stored) ? stored : DEFAULT_ROWS
}

export function colCount(sheet: SheetMap): number {
  const stored = Number(sheet.get('colCount') ?? DEFAULT_COLS)
  return Number.isFinite(stored) ? stored : DEFAULT_COLS
}

export function growRows(doc: Y.Doc, sheet: SheetMap, extra: number): void {
  const rows = rowsArray(sheet)
  if (!rows) return
  const wanted = Math.min(rows.length + Math.max(Math.trunc(extra), 0), MAX_ROWS)
  const missing = wanted - rows.length
  if (missing <= 0) return
  doc.transact(() => rows.push(Array.from({ length: missing }, newRowId)))
}

export function growCols(doc: Y.Doc, sheet: SheetMap, extra: number): void {
  const next = Math.min(colCount(sheet) + Math.max(Math.trunc(extra), 0), MAX_COLS)
  if (next === colCount(sheet)) return
  doc.transact(() => sheet.set('colCount', next))
}

export function readRaw(sheet: SheetMap, row: number, col: number): string | null {
  const mapKey = keyAt(sheet, row, col)
  if (mapKey === null) return null
  const cell = cellsOf(sheet).get(mapKey)
  if (!cell) return null
  const raw = cell.get(KEYS.raw)
  return raw === undefined || raw === null ? null : String(raw)
}

export function readStyle(sheet: SheetMap, row: number, col: number): CellStyle {
  const mapKey = keyAt(sheet, row, col)
  const cell = mapKey === null ? undefined : cellsOf(sheet).get(mapKey)
  if (!cell) return {}
  return {
    bold: cell.get(KEYS.bold) as boolean | undefined,
    italic: cell.get(KEYS.italic) as boolean | undefined,
    underline: cell.get(KEYS.underline) as boolean | undefined,
    align: cell.get(KEYS.align) as Align | undefined,
    color: cell.get(KEYS.color) as string | undefined,
    background: cell.get(KEYS.background) as string | undefined,
    format: cell.get(KEYS.format) as NumberFormat | undefined,
  }
}

/**
 * Ключ ячейки для записи: недостающие строки и столбцы досоздаются.
 *
 * Без этого вставка из буфера за пределы листа записывала данные, которых
 * потом не видно: сетка рисуется по объявленному числу строк, а ячейки лежали
 * за ним и всплывали только в выгрузке. null — дальше растить некуда.
 */
function keyForWrite(doc: Y.Doc, sheet: SheetMap, row: number, col: number): string | null {
  if (!Number.isInteger(row) || row < 0 || row >= MAX_ROWS) return null
  if (!Number.isInteger(col) || col < 0 || col >= MAX_COLS) return null

  if (col >= colCount(sheet)) growCols(doc, sheet, col + 1 - colCount(sheet))

  const rows = rowsArray(sheet)
  if (rows && row >= rows.length) growRows(doc, sheet, row + 1 - rows.length)

  return keyAt(sheet, row, col)
}

function cellFor(doc: Y.Doc, sheet: SheetMap, row: number, col: number): CellMap | null {
  const mapKey = keyForWrite(doc, sheet, row, col)
  if (mapKey === null) return null

  const cells = cellsOf(sheet)
  const existing = cells.get(mapKey)
  if (existing) return existing

  const created = new Y.Map<unknown>()
  cells.set(mapKey, created)
  return created
}

/** Пустая ячейка без оформления удаляется: иначе лист копит мусор. */
function dropIfEmpty(sheet: SheetMap, mapKey: string): void {
  const cells = cellsOf(sheet)
  const cell = cells.get(mapKey)
  if (cell && cell.size === 0) cells.delete(mapKey)
}

export function writeCell(doc: Y.Doc, sheet: SheetMap, row: number, col: number,
                          raw: string): void {
  doc.transact(() => {
    if (raw === '') {
      const mapKey = keyAt(sheet, row, col)
      if (mapKey === null) return
      const cell = cellsOf(sheet).get(mapKey)
      if (cell) cell.delete(KEYS.raw)
      dropIfEmpty(sheet, mapKey)
      return
    }
    cellFor(doc, sheet, row, col)?.set(KEYS.raw, raw)
  })
}

export function clearCells(doc: Y.Doc, sheet: SheetMap,
                           cells: Array<{ row: number; col: number }>): void {
  doc.transact(() => {
    for (const { row, col } of cells) {
      const mapKey = keyAt(sheet, row, col)
      if (mapKey === null) continue
      const cell = cellsOf(sheet).get(mapKey)
      if (!cell) continue
      cell.delete(KEYS.raw)
      dropIfEmpty(sheet, mapKey)
    }
  })
}

export function applyStyle(doc: Y.Doc, sheet: SheetMap,
                           cells: Array<{ row: number; col: number }>,
                           patch: CellStyle): void {
  doc.transact(() => {
    for (const { row, col } of cells) {
      const cell = cellFor(doc, sheet, row, col)
      if (!cell) continue
      for (const [name, value] of Object.entries(patch)) {
        const field = KEYS[name as keyof typeof KEYS]
        if (!field) continue
        // undefined снимает оформление, а не записывает пустое значение.
        if (value === undefined) cell.delete(field)
        else cell.set(field, value)
      }
      const mapKey = keyAt(sheet, row, col)
      if (mapKey !== null) dropIfEmpty(sheet, mapKey)
    }
  })
}

// ------------------------------ Ширина столбцов ------------------------------

export type CellHit = {
  row: number
  col: number
  text: string
  /** Номер листа. Заполняется только при поиске по всей книге. */
  sheet?: number
  /**
   * Совпадение найдено во введённом тексте, а не в посчитанном значении.
   * Заменять можно только такие: подменять результат формулы бессмысленно —
   * при следующем пересчёте он вернётся.
   */
  inRaw: boolean
}

export type FindOptions = {
  matchCase?: boolean
  wholeCell?: boolean
}

function textMatches(text: string, needle: string, options: FindOptions): boolean {
  const left = options.matchCase ? text : text.toLowerCase()
  const right = options.matchCase ? needle : needle.toLowerCase()
  return options.wholeCell ? left === right : left.includes(right)
}

/**
 * Поиск по листу.
 *
 * Перебираются только заполненные ячейки, а не вся сетка: на листе в пять
 * тысяч строк заполнено обычно несколько сотен клеток, и обход прямоугольника
 * искал бы в пустоте.
 *
 * Ищется и по введённому, и по посчитанному: номер счёта человек помнит как
 * «4501», а в ячейке может лежать формула, показывающая это число.
 */
export function findCells(
  sheet: SheetMap,
  query: string,
  display?: (row: number, col: number) => string,
  options: FindOptions = {},
): CellHit[] {
  const needle = query.trim()
  if (!needle) return []

  const hits: CellHit[] = []
  const order = rowOrder(sheet)

  cellsOf(sheet).forEach((cell, mapKey) => {
    const at = parseKey(mapKey, order)
    if (!at) return
    const { row, col } = at

    const raw = cell.get(KEYS.raw)
    const text = raw === undefined || raw === null ? '' : String(raw)
    if (textMatches(text, needle, options)) {
      hits.push({ row, col, text, inRaw: true })
      return
    }

    const shown = display?.(row, col) ?? ''
    if (textMatches(shown, needle, options)) {
      hits.push({ row, col, text: shown, inRaw: false })
    }
  })

  // Порядок обхода Y.Map произвольный, а человек ждёт движения сверху вниз.
  return hits.sort((a, b) => a.row - b.row || a.col - b.col)
}

/**
 * Поиск по всей книге.
 *
 * Листы обходятся по порядку, номер листа едет вместе с совпадением: без него
 * переход к найденному не знал бы, куда переключаться.
 */
export function findInBook(
  doc: Y.Doc,
  query: string,
  displayFor: (sheetIndex: number) => (row: number, col: number) => string,
  options: FindOptions = {},
): CellHit[] {
  const hits: CellHit[] = []

  book(doc).toArray().forEach((sheet, sheetIndex) => {
    for (const hit of findCells(sheet, query, displayFor(sheetIndex), options)) {
      hits.push({ ...hit, sheet: sheetIndex })
    }
  })

  return hits
}

/**
 * Замена в одной ячейке.
 *
 * Меняется введённый текст, поэтому формула правится как формула: замена
 * «2024» на «2025» в =СУММ(Данные2024!A1:A9) поменяет ссылку, а не результат.
 * Возвращает false, если менять было нечего.
 */
export function replaceInCell(
  doc: Y.Doc,
  sheet: SheetMap,
  row: number,
  col: number,
  query: string,
  replacement: string,
  options: FindOptions = {},
): boolean {
  const raw = readRaw(sheet, row, col)
  if (raw === null) return false

  const needle = query.trim()
  if (!needle) return false

  let next: string

  if (options.wholeCell) {
    if (!textMatches(raw, needle, options)) return false
    next = replacement
  } else {
    // Регистронезависимый поиск идёт по самому тексту, а не по его копии в
    // нижнем регистре: в турецком «İ» при toLowerCase превращается в два
    // символа, позиции в копии и в оригинале расходятся, и замена резала
    // строку не там. Запрос экранируется — в нём бывают точка и скобка,
    // а замена подставляется функцией, чтобы «$&» остался текстом.
    const pattern = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const matcher = new RegExp(pattern, options.matchCase ? 'gu' : 'giu')
    if (!matcher.test(raw)) return false
    matcher.lastIndex = 0
    next = raw.replace(matcher, () => replacement)
  }

  if (next === raw) return false
  writeCell(doc, sheet, row, col, next)
  return true
}

export function colWidth(sheet: SheetMap, col: number): number {
  const widths = sheet.get('cols') as Y.Map<number> | undefined
  const value = widths?.get(String(col))
  return typeof value === 'number' ? value : DEFAULT_COL_WIDTH
}

export function setColWidth(doc: Y.Doc, sheet: SheetMap, col: number, width: number): void {
  const widths = sheet.get('cols') as Y.Map<number>
  doc.transact(() => widths.set(String(col), Math.max(MIN_COL_WIDTH, Math.round(width))))
}

// --------------------------- Строки и столбцы ---------------------------

/**
 * Ссылка или диапазон в формуле: «C2», «$C$2», «C2:C10».
 *
 * Знак доллара у столбца и у строки разобран отдельно: раньше оба висели на
 * одной группе, и «$C2» считалось закреплённым целиком.
 */
const REFS = /(\$?)([A-Za-z]+)(\$?)(\d+)(?::(\$?)([A-Za-z]+)(\$?)(\d+))?/g

/** Куда ссылка попала: одиночная, начало диапазона или его конец. */
type RefKind = 'single' | 'from' | 'to'

/** null означает, что ссылка стала недействительной. */
type Axis = (value: number, kind: RefKind) => number | null

type RefMove = {
  row?: Axis
  col?: Axis
}

/** Ссылка на удалённую строку или столбец. Читается так же, как в Excel. */
const REF_ERROR = '#ССЫЛКА!'

function shiftPart(value: number, pinned: boolean, axis: Axis | undefined,
                   kind: RefKind): number | null {
  if (pinned || !axis) return value
  return axis(value, kind)
}

/**
 * Проходит по ссылкам формулы, оставляя нетронутым всё остальное.
 *
 * Кавычки пропускаются целиком: «B2» внутри текста — это текст, а не ссылка.
 * Знак доллара означает, что координату закрепили намеренно, и она не едет.
 *
 * Отсеиваются три похожих на ссылку случая, на которых прежняя версия
 * ошибалась: «1e5» — запись числа, а не столбец «e», строка 5; «LOG10(» —
 * имя функции; «A1B2» — вообще не адрес. Каждый из них правка строк молча
 * портила, а «=1e5*2» после вставки строки превращался в «=1e6*2».
 */
function mapFormulaRefs(raw: string, move: RefMove): string {
  if (!raw.startsWith('=')) return raw

  return raw
    .split(/("(?:[^"]|"")*")/)
    .map((part, index) => {
      // Нечётные куски — содержимое кавычек вместе с ними.
      if (index % 2 === 1) return part

      return part.replace(REFS, (match: string, colPinA: string, colA: string,
                                 rowPinA: string, rowA: string,
                                 colPinB: string | undefined, colB: string,
                                 rowPinB: string, rowB: string,
                                 offset: number) => {
        const before = part[offset - 1]
        const after = part[offset + match.length]
        if (before !== undefined && /[A-Za-z0-9_.]/.test(before)) return match
        if (after === '(') return match
        if (after !== undefined && /[A-Za-z0-9_]/.test(after)) return match

        const range = colPinB !== undefined
        const kindA: RefKind = range ? 'from' : 'single'

        const fromRow = shiftPart(Number(rowA) - 1, rowPinA === '$', move.row, kindA)
        const fromCol = shiftPart(colIndex(colA), colPinA === '$', move.col, kindA)
        if (fromRow === null || fromCol === null) return REF_ERROR

        const head = `${colPinA}${colLabel(fromCol)}${rowPinA}${fromRow + 1}`
        if (!range) return head

        const toRow = shiftPart(Number(rowB) - 1, rowPinB === '$', move.row, 'to')
        const toCol = shiftPart(colIndex(colB), colPinB === '$', move.col, 'to')
        if (toRow === null || toCol === null) return REF_ERROR
        // Диапазон схлопнулся: его единственную строку или столбец удалили.
        if (toRow < fromRow || toCol < fromCol) return REF_ERROR

        return `${head}:${colPinB}${colLabel(toCol)}${rowPinB}${toRow + 1}`
      })
    })
    .join('')
}

/**
 * Переписывает ссылки в формуле после вставки строки.
 *
 * Без этого итог под таблицей врёт молча: ячейки уезжают вниз, а «=СУММ(C2:C5)»
 * остаётся прежней и считает уже не те строки. Молчаливо неверная сумма хуже
 * заметной ошибки — по ней принимают решения.
 *
 * Диапазон, к которому строка примыкает снизу, расширяется: строку и добавляли
 * затем, чтобы она попала в итог. Excel в этом месте ведёт себя иначе, но там
 * человек видит формулу и правит её сам, а здесь итог обычно ставят один раз
 * из шаблона и больше не открывают.
 */
function shiftRowsInFormula(raw: string, at: number): string {
  return mapFormulaRefs(raw, {
    row: (row, kind) => {
      if (row >= at) return row + 1
      // Конец диапазона, к которому новая строка примыкает снизу.
      if (kind === 'to' && row === at - 1) return row + 1
      return row
    },
  })
}

/**
 * Переписывает ссылки после удаления строки.
 *
 * Ссылка ровно на удалённую строку становится ошибкой, а не начинает молча
 * считать заехавшую на её место соседнюю: «=A2*2» после удаления второй
 * строки давал ноль вместо видимой ошибки, и это уходило в отчёт.
 */
function dropRowInFormula(raw: string, at: number): string {
  return mapFormulaRefs(raw, {
    row: (row, kind) => {
      if (kind === 'single') {
        if (row === at) return null
        return row > at ? row - 1 : row
      }
      // Границы диапазона не рвутся, а сжимаются вместе с ним.
      if (kind === 'from') return row > at ? row - 1 : row
      return row >= at ? row - 1 : row
    },
  })
}

/** То же для столбцов: вставка сдвигает вправо, удаление — влево. */
function shiftColsInFormula(raw: string, at: number): string {
  return mapFormulaRefs(raw, {
    col: (col, kind) => {
      if (col >= at) return col + 1
      if (kind === 'to' && col === at - 1) return col + 1
      return col
    },
  })
}

function dropColInFormula(raw: string, at: number): string {
  return mapFormulaRefs(raw, {
    col: (col, kind) => {
      if (kind === 'single') {
        if (col === at) return null
        return col > at ? col - 1 : col
      }
      if (kind === 'from') return col > at ? col - 1 : col
      return col >= at ? col - 1 : col
    },
  })
}

/**
 * Переносит формулу на другую строку так, как это делает протягивание вниз:
 * «=E2*F2» из второй строки в пятой становится «=E5*F5».
 *
 * Уехавшая выше первой строки ссылка становится ошибкой. Прежняя версия
 * прижимала её к первой строке, и формула молча начинала считать чужие данные.
 */
export function shiftFormulaToRow(raw: string, from: number, to: number): string {
  const delta = to - from
  if (delta === 0) return raw
  return mapFormulaRefs(raw, {
    row: (row) => {
      const next = row + delta
      return next < 0 || next >= MAX_ROWS ? null : next
    },
  })
}

/** Переписывает формулы всех ячеек листа. Ячейки при этом не пересоздаются. */
function rewriteFormulas(sheet: SheetMap, rewrite: (raw: string) => string): void {
  cellsOf(sheet).forEach((cell) => {
    const raw = cell.get(KEYS.raw)
    if (typeof raw !== 'string' || !raw.startsWith('=')) return
    const next = rewrite(raw)
    if (next !== raw) cell.set(KEYS.raw, next)
  })
}

/**
 * Вставка строки — это вставка одного элемента в список строк.
 *
 * Ключи ячеек остаются прежними, потому что строка опознаётся по
 * идентификатору. Приращение в сеть — несколько байт вместо полной карты
 * листа, и правка соседа, пришедшая в тот же момент, не теряется.
 */
export function insertRow(doc: Y.Doc, sheet: SheetMap, at: number): void {
  const rows = rowsArray(sheet)
  if (!rows || rows.length >= MAX_ROWS) return

  const index = Math.max(0, Math.min(Math.trunc(at), rows.length))
  doc.transact(() => {
    rows.insert(index, [newRowId()])
    rewriteFormulas(sheet, (raw) => shiftRowsInFormula(raw, index))
  })
}

export function deleteRow(doc: Y.Doc, sheet: SheetMap, at: number): void {
  const rows = rowsArray(sheet)
  if (!rows || rows.length <= 1) return

  const index = Math.trunc(at)
  if (index < 0 || index >= rows.length) return
  const rowId = rows.get(index)

  doc.transact(() => {
    rows.delete(index, 1)

    const cells = cellsOf(sheet)
    for (const mapKey of Array.from(cells.keys())) {
      if (mapKey.slice(0, mapKey.indexOf(':')) === rowId) cells.delete(mapKey)
    }

    rewriteFormulas(sheet, (raw) => dropRowInFormula(raw, index))
  })
}

/**
 * Последняя строка, в которой хоть что-то есть. -1 — лист пуст.
 *
 * Нужна форме добавления: новая запись идёт следом за последней, а не в первую
 * попавшуюся пустую клетку посреди таблицы.
 */
export function lastFilledRow(sheet: SheetMap): number {
  const order = rowOrder(sheet)
  let last = -1
  cellsOf(sheet).forEach((cell, mapKey) => {
    const raw = cell.get(KEYS.raw)
    if (raw === undefined || raw === null || raw === '') return
    const at = parseKey(mapKey, order)
    if (at && at.row > last) last = at.row
  })
  return last
}

// --------------------------- Настройки листа ---------------------------
//
// Закрепление, фильтры, списки значений, правила подсветки и диаграммы живут
// в самом листе, а не в состоянии вкладки: настроил один — видят все, и после
// перезагрузки ничего не теряется.

/** Сколько строк и столбцов закреплено: они не уезжают при прокрутке. */
export type Frozen = { rows: number; cols: number }

export function frozen(sheet: SheetMap): Frozen {
  const value = sheet.get('frozen') as Partial<Frozen> | undefined
  const rows = Number(value?.rows ?? 0)
  const cols = Number(value?.cols ?? 0)
  return {
    rows: Number.isFinite(rows) ? Math.max(0, Math.min(rows, 10)) : 0,
    cols: Number.isFinite(cols) ? Math.max(0, Math.min(cols, 10)) : 0,
  }
}

export function setFrozen(doc: Y.Doc, sheet: SheetMap, patch: Partial<Frozen>): void {
  const next = { ...frozen(sheet), ...patch }
  doc.transact(() => sheet.set('frozen', next))
}

/**
 * Отбор по столбцу: перечислением значений или промежутком.
 *
 * Перечисление отвечает на «покажи эту машину», промежуток — на «покажи, что
 * должно прийти с понедельника по среду» и «долги больше ста тысяч». Список
 * галочек для второго не годится: значений в колонке со временем столько же,
 * сколько строк.
 */
export type ColumnFilter =
  | { kind: 'values'; values: string[] }
  | { kind: 'range'; from: string; to: string }

/** Разбирает сохранённый отбор. Массив — прежний формат, только значения. */
export function columnFilter(sheet: SheetMap, col: number): ColumnFilter | null {
  const all = sheet.get('filters') as Record<string, unknown> | undefined
  const stored = all?.[String(col)]
  if (!stored) return null

  if (Array.isArray(stored)) return { kind: 'values', values: stored as string[] }
  if (typeof stored === 'object') {
    const item = stored as Partial<ColumnFilter> & { from?: string; to?: string; values?: string[] }
    if (item.kind === 'range') return { kind: 'range', from: item.from ?? '', to: item.to ?? '' }
    if (Array.isArray(item.values)) return { kind: 'values', values: item.values }
  }
  return null
}

export function columnsWithFilter(sheet: SheetMap): number[] {
  const all = sheet.get('filters') as Record<string, unknown> | undefined
  if (!all) return []
  return Object.keys(all).map(Number).filter((col) => Number.isInteger(col))
}

export function setColumnFilter(doc: Y.Doc, sheet: SheetMap,
                                col: number, filter: ColumnFilter | null): void {
  const all = { ...((sheet.get('filters') as Record<string, unknown>) ?? {}) }
  if (filter === null) delete all[String(col)]
  else all[String(col)] = filter
  doc.transact(() => sheet.set('filters', all))
}

/**
 * Значение ячейки числом — для сравнения в промежутке.
 *
 * Числа сравниваются числами, время и даты — мгновением на оси времени.
 * «1 234,50 ₽» — это 1234.5: знак валюты и разряды приходят из формата ячейки,
 * а не от человека, и мешать сравнению не должны.
 */
export function comparableValue(text: string): number | null {
  const value = text.trim()
  if (!value) return null

  const moment = parseDeadline(value)
  if (moment) return moment.getTime()

  const cleaned = value.replace(/[^\d,.\-]/g, '').replace(/\s/g, '').replace(',', '.')
  if (!cleaned || cleaned === '-') return null
  const number = Number(cleaned)
  return Number.isFinite(number) ? number : null
}

/** Проходит ли значение отбор. */
export function filterAccepts(filter: ColumnFilter, text: string): boolean {
  if (filter.kind === 'values') return filter.values.includes(text)

  const value = comparableValue(text)
  const from = comparableValue(filter.from)
  const to = comparableValue(filter.to)

  if (value === null) {
    // Не число и не время: в промежуток попасть не может. Пустые строки при
    // отборе по сроку прячем — иначе «что придёт сегодня» показывает и
    // незаполненные строки, ради которых отбор и затевали.
    return false
  }

  if (from !== null && value < from) return false
  if (to !== null && value > to) return false
  return true
}

/**
 * Строки, скрытые фильтром.
 *
 * Сравнивается показанное значение, а не введённое: в колонке с формулой
 * человек выбирает из того, что видит на экране, а не из «=C2*D2».
 */
export function hiddenRows(
  sheet: SheetMap,
  display: (row: number, col: number) => string,
  upTo: number,
): Set<number> {
  const hidden = new Set<number>()
  const columns = columnsWithFilter(sheet)
  if (columns.length === 0) return hidden

  // Итог под таблицей фильтр не скрывает: в его строке колонки пустые, под
  // любой отбор она не подходит — и сумма пропадала бы при каждом фильтре,
  // хотя как раз тогда на неё и смотрят.
  const last = upTo > 0 && rowHasFormula(sheet, upTo) ? upTo - 1 : upTo

  for (let row = 1; row <= last; row += 1) {
    for (const col of columns) {
      const filter = columnFilter(sheet, col)
      if (!filter) continue
      if (!filterAccepts(filter, display(row, col))) {
        hidden.add(row)
        break
      }
    }
  }
  return hidden
}

/**
 * Номер столбца по началу его заголовка. null — такого столбца нет.
 *
 * Ищем по шапке, а не по номеру: у каждого свой порядок колонок, и привязка
 * к «столбцу K» сломалась бы от одной вставки слева.
 */
export function findColumn(sheet: SheetMap, prefixes: string[]): number | null {
  const total = colCount(sheet)
  for (let col = 0; col < total; col += 1) {
    const header = (readRaw(sheet, 0, col) ?? '').trim().toLowerCase()
    if (!header) continue
    if (prefixes.some((prefix) => header.startsWith(prefix))) return col
  }
  return null
}

/** Заголовки колонок, которые заполняет отметка о приёмке. */
export const ARRIVAL_COLUMNS = {
  status: ['статус', 'состояние', 'status', 'абал'],
  acceptedBy: ['принял', 'кто принял', 'приёмщик', 'приемщик', 'accepted'],
  acceptedAt: ['принято', 'время приёмки', 'время приемки', 'факт'],
}

/**
 * Отметка о прибытии машины.
 *
 * Ставит статус, имя принявшего и время — одним нажатием, чтобы это не
 * набирали руками по три ячейки и не забывали половину. Пишется в те колонки,
 * которые нашлись: таблица без колонки «Принял» всё равно получит статус.
 *
 * Возвращает список заполненного — по нему интерфейс говорит, что произошло.
 */
export function markArrived(doc: Y.Doc, sheet: SheetMap, row: number,
                            who: string): string[] {
  if (row <= 0) return []

  const now = new Date()
  const time = `${String(now.getDate()).padStart(2, '0')}.`
    + `${String(now.getMonth() + 1).padStart(2, '0')}.${now.getFullYear()} `
    + `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const filled: string[] = []
  doc.transact(() => {
    const status = findColumn(sheet, ARRIVAL_COLUMNS.status)
    if (status !== null) {
      writeCell(doc, sheet, row, status, 'Прибыл')
      filled.push('статус')
    }

    const by = findColumn(sheet, ARRIVAL_COLUMNS.acceptedBy)
    if (by !== null && who) {
      writeCell(doc, sheet, row, by, who)
      filled.push('кто принял')
    }

    const at = findColumn(sheet, ARRIVAL_COLUMNS.acceptedAt)
    if (at !== null) {
      writeCell(doc, sheet, row, at, time)
      filled.push('время')
    }
  })
  return filled
}

/** Список допустимых значений столбца: вместо набора руками — выбор. */
export function validation(sheet: SheetMap, col: number): string[] | null {
  const all = sheet.get('validations') as Record<string, string[]> | undefined
  const values = all?.[String(col)]
  return Array.isArray(values) && values.length > 0 ? values : null
}

export function setValidation(doc: Y.Doc, sheet: SheetMap,
                              col: number, values: string[] | null): void {
  const all = { ...((sheet.get('validations') as Record<string, string[]>) ?? {}) }
  if (values === null || values.length === 0) delete all[String(col)]
  else all[String(col)] = values
  doc.transact(() => sheet.set('validations', all))
}

/** Своё правило подсветки: цвет по условию, а не по смыслу слова. */
export type ColorRule = {
  col: number
  op: 'gt' | 'lt' | 'eq' | 'contains' | 'empty'
  value: string
  background: string
  color: string
}

export function colorRules(sheet: SheetMap): ColorRule[] {
  const list = sheet.get('rules') as ColorRule[] | undefined
  return Array.isArray(list) ? list : []
}

export function setColorRules(doc: Y.Doc, sheet: SheetMap, list: ColorRule[]): void {
  doc.transact(() => sheet.set('rules', list))
}

/** Подходит ли значение под правило. Числа сравниваются числами. */
export function ruleMatches(rule: ColorRule, text: string): boolean {
  const value = text.trim()
  if (rule.op === 'empty') return value === ''
  if (value === '') return false

  if (rule.op === 'contains') {
    return value.toLowerCase().includes(rule.value.trim().toLowerCase())
  }

  const left = Number(value.replace(/\s/g, '').replace(',', '.'))
  const right = Number(rule.value.replace(/\s/g, '').replace(',', '.'))
  if (Number.isNaN(left) || Number.isNaN(right)) {
    // Не числа — сравниваем как текст: «равно» осмысленно и для слов.
    return rule.op === 'eq' && value.toLowerCase() === rule.value.trim().toLowerCase()
  }

  if (rule.op === 'gt') return left > right
  if (rule.op === 'lt') return left < right
  return left === right
}

/** Диаграмма по столбцам листа. */
export type ChartSpec = {
  id: string
  kind: 'bar' | 'line' | 'pie'
  title: string
  /** Столбец подписей и столбец чисел. */
  labelCol: number
  valueCol: number
  fromRow: number
  toRow: number
}

export function charts(sheet: SheetMap): ChartSpec[] {
  const list = sheet.get('charts') as ChartSpec[] | undefined
  return Array.isArray(list) ? list : []
}

export function setCharts(doc: Y.Doc, sheet: SheetMap, list: ChartSpec[]): void {
  doc.transact(() => sheet.set('charts', list))
}

export const newChartId = () => `c${Math.random().toString(36).slice(2, 8)}`

/**
 * Сортировка строк по столбцу.
 *
 * Переставляется содержимое строк, а не сами строки. Казалось бы, проще
 * переложить идентификаторы в списке строк — но в CRDT это разрушительно:
 * удаление с последующей вставкой тех же значений сливается с состоянием,
 * пришедшим от сервера или из местного хранилища, как две разные правки, и
 * строки размножаются. Проверено на живой вкладке: после сортировки лист
 * распухал вдвое, а данные уезжали за пределы экрана.
 *
 * Поэтому список строк остаётся нетронутым, а по местам едут ячейки. Формулы
 * внутри переехавшей строки переписываются на новое место — «=E2*F2» из
 * второй строки в пятой становится «=E5*F5», как при протягивании.
 *
 * Строки вне участка from..to не трогаются: шапка сверху и итог снизу должны
 * остаться там, где стояли.
 */
export function sortRows(doc: Y.Doc, sheet: SheetMap, col: number,
                         direction: 'asc' | 'desc', from: number, to: number): void {
  const total = rowCount(sheet)
  const first = Math.max(0, Math.trunc(from))
  const last = Math.min(total - 1, Math.trunc(to))
  if (last <= first) return

  const items: Array<{ row: number; text: string }> = []
  for (let row = first; row <= last; row += 1) {
    items.push({ row, text: (readRaw(sheet, row, col) ?? '').trim() })
  }

  const numeric = (text: string) => {
    if (text === '') return null
    const value = Number(text.replace(/\s/g, '').replace(',', '.'))
    return Number.isNaN(value) ? null : value
  }

  const sorted = [...items].sort((a, b) => {
    // Пустые всегда внизу: строка без значения не должна оказаться первой
    // только потому, что пустота «меньше» любого текста.
    if (a.text === '' && b.text === '') return 0
    if (a.text === '') return 1
    if (b.text === '') return -1

    const left = numeric(a.text)
    const right = numeric(b.text)
    const order = left !== null && right !== null
      ? left - right
      : a.text.localeCompare(b.text, 'ru', { numeric: true, sensitivity: 'base' })
    return direction === 'asc' ? order : -order
  })

  if (sorted.every((item, index) => item.row === first + index)) return

  const cells = cellsOf(sheet)

  // Снимок содержимого каждой строки участка: номер столбца и поля ячейки.
  const snapshot = new Map<number, Array<{ col: number; data: Array<[string, unknown]> }>>()
  for (const item of items) {
    const rowId = rowIdAt(sheet, item.row)
    if (rowId === null) return
    const row: Array<{ col: number; data: Array<[string, unknown]> }> = []
    cells.forEach((cell, mapKey) => {
      const at = mapKey.indexOf(':')
      if (mapKey.slice(0, at) !== rowId) return
      row.push({ col: Number(mapKey.slice(at + 1)), data: Array.from(cell.entries()) })
    })
    snapshot.set(item.row, row)
  }

  doc.transact(() => {
    // Сначала убираем всё с участка, иначе ячейка, которой нет в новой
    // строке, осталась бы от прежней.
    for (const item of items) {
      const rowId = rowIdAt(sheet, item.row)
      if (rowId === null) continue
      for (const mapKey of Array.from(cells.keys())) {
        if (mapKey.slice(0, mapKey.indexOf(':')) === rowId) cells.delete(mapKey)
      }
    }

    sorted.forEach((item, index) => {
      const target = first + index
      const targetId = rowIdAt(sheet, target)
      if (targetId === null) return

      for (const { col: column, data } of snapshot.get(item.row) ?? []) {
        const cell = new Y.Map<unknown>()
        for (const [field, value] of data) {
          if (field === KEYS.raw && typeof value === 'string' && value.startsWith('=')) {
            cell.set(field, shiftFormulaToRow(value, item.row, target))
          } else {
            cell.set(field, value)
          }
        }
        cells.set(key(targetId, column), cell)
      }
    })
  })
}

/** Есть ли в строке формула: по ней узнаётся итоговая строка под таблицей. */
export function rowHasFormula(sheet: SheetMap, row: number): boolean {
  const rowId = rowIdAt(sheet, row)
  if (rowId === null) return false

  let found = false
  cellsOf(sheet).forEach((cell, mapKey) => {
    if (found || mapKey.slice(0, mapKey.indexOf(':')) !== rowId) return
    const raw = cell.get(KEYS.raw)
    if (typeof raw === 'string' && raw.startsWith('=')) found = true
  })
  return found
}

/** Название листа, куда уезжают прибывшие рейсы. */
export const DELIVERED_SHEET = 'Груз прибыл'

/**
 * Переносит строку на другой лист книги.
 *
 * Прибывший рейс в рабочем журнале только мешает: он уже никуда не едет, а
 * место занимает и глаза отвлекает. В таблицах такое разносят по вкладкам
 * руками — вырезал, вставил; здесь это делает кнопка приёмки.
 *
 * Лист-приёмник создаётся при первом переносе и получает ту же шапку, иначе
 * колонки на нём не совпали бы с журналом и отбор по ним перестал бы работать.
 *
 * Возвращает номер строки на листе-приёмнике или -1, если переносить нечего.
 */
export function moveRowToSheet(doc: Y.Doc, from: SheetMap, row: number,
                               sheetName: string): number {
  if (row <= 0) return -1

  const rowId = rowIdAt(from, row)
  if (rowId === null) return -1

  // Содержимое строки и шапка — снимком, до всяких изменений.
  const cells = cellsOf(from)
  const payload: Array<{ col: number; data: Array<[string, unknown]> }> = []
  cells.forEach((cell, mapKey) => {
    const at = mapKey.indexOf(':')
    if (mapKey.slice(0, at) !== rowId) return
    payload.push({ col: Number(mapKey.slice(at + 1)), data: Array.from(cell.entries()) })
  })
  if (payload.length === 0) return -1

  const header: Array<{ col: number; data: Array<[string, unknown]> }> = []
  const headerId = rowIdAt(from, 0)
  if (headerId !== null) {
    cells.forEach((cell, mapKey) => {
      const at = mapKey.indexOf(':')
      if (mapKey.slice(0, at) !== headerId) return
      header.push({ col: Number(mapKey.slice(at + 1)), data: Array.from(cell.entries()) })
    })
  }

  let landed = -1

  doc.transact(() => {
    const sheets = book(doc)
    let target = sheets.toArray().find((item) => String(item.get('name')) === sheetName)

    if (!target) {
      target = makeSheet(sheetName)
      sheets.push([target])
      // Шапка переезжает вместе с первой записью: без неё на новом листе
      // не работали бы ни отбор, ни подсветка срока.
      const targetCells = cellsOf(target)
      const targetHeaderId = rowIdAt(target, 0)
      if (targetHeaderId !== null) {
        for (const { col, data } of header) {
          const cell = new Y.Map<unknown>()
          for (const [field, value] of data) cell.set(field, value)
          targetCells.set(key(targetHeaderId, col), cell)
        }
      }
      // Столбцов на приёмнике должно быть не меньше, чем в журнале.
      const width = colCount(from)
      if (colCount(target) < width) target.set('colCount', width)
    }

    const at = Math.max(lastFilledRow(target) + 1, 1)
    const rows = rowsArray(target)
    if (rows && at >= rows.length) {
      rows.push(Array.from({ length: at - rows.length + 1 }, newRowId))
    }

    const targetId = rowIdAt(target, at)
    if (targetId === null) return

    const targetCells = cellsOf(target)
    for (const { col, data } of payload) {
      const cell = new Y.Map<unknown>()
      for (const [field, value] of data) {
        // Формула, посчитанная от соседей по журналу, на новом листе
        // считала бы пустоту: переносим то, что она показывала.
        if (field === KEYS.raw && typeof value === 'string' && value.startsWith('=')) {
          cell.set(field, shiftFormulaToRow(value, row, at))
        } else {
          cell.set(field, value)
        }
      }
      targetCells.set(key(targetId, col), cell)
    }

    landed = at
    deleteRow(doc, from, row)
  })

  return landed
}

/**
 * Переносит ячейки по столбцам.
 *
 * У столбцов своего идентификатора нет, поэтому переезжающая ячейка всё-таки
 * пересоздаётся. Но трогаются только те ячейки, которые действительно едут:
 * прежняя версия стирала карту листа целиком, и вместе с ней пропадали чужие
 * правки в столбцах, которых операция вообще не касалась.
 *
 * Порядок обхода выбран так, чтобы переезжающая ячейка не села на ещё не
 * сдвинутую соседнюю.
 */
function moveCols(doc: Y.Doc, sheet: SheetMap, move: (col: number) => number | null,
                  order: 'asc' | 'desc'): void {
  const cells = cellsOf(sheet)

  const items: Array<{ mapKey: string; rowId: string; col: number }> = []
  cells.forEach((_cell, mapKey) => {
    const at = mapKey.indexOf(':')
    if (at === -1) return
    const col = Number(mapKey.slice(at + 1))
    if (!Number.isInteger(col)) return
    items.push({ mapKey, rowId: mapKey.slice(0, at), col })
  })
  items.sort((a, b) => (order === 'asc' ? a.col - b.col : b.col - a.col))

  doc.transact(() => {
    for (const item of items) {
      const cell = cells.get(item.mapKey)
      if (!cell) continue

      const target = move(item.col)
      if (target === item.col) continue

      const data = Array.from(cell.entries())
      cells.delete(item.mapKey)
      if (target === null || target < 0 || target >= MAX_COLS) continue

      const moved = new Y.Map<unknown>()
      for (const [field, value] of data) moved.set(field, value)
      cells.set(key(item.rowId, target), moved)
    }
  })
}

export function insertCol(doc: Y.Doc, sheet: SheetMap, at: number): void {
  if (colCount(sheet) >= MAX_COLS) return
  const index = Math.max(0, Math.trunc(at))

  moveCols(doc, sheet, (col) => (col >= index ? col + 1 : col), 'desc')
  doc.transact(() => {
    rewriteFormulas(sheet, (raw) => shiftColsInFormula(raw, index))
    sheet.set('colCount', Math.min(colCount(sheet) + 1, MAX_COLS))
  })
}

export function deleteCol(doc: Y.Doc, sheet: SheetMap, at: number): void {
  if (colCount(sheet) <= 1) return
  const index = Math.max(0, Math.trunc(at))

  moveCols(doc, sheet, (col) => {
    if (col === index) return null
    return col > index ? col - 1 : col
  }, 'asc')
  doc.transact(() => {
    rewriteFormulas(sheet, (raw) => dropColInFormula(raw, index))
    sheet.set('colCount', Math.max(colCount(sheet) - 1, 1))
  })
}

// ------------------------------- Сохранение -------------------------------

/**
 * Снимок для сервера: поиск и история работают с обычным JSON, а не с
 * двоичным состоянием Yjs. Формат совпадает с тем, что разбирает text.py.
 */
export function serializeBook(doc: Y.Doc): Record<string, unknown> {
  const sheets = book(doc)
    .toArray()
    .map((sheet) => {
      const cells: Record<string, Record<string, unknown>> = {}

      // Вместе с введённым уходит и посчитанное: сервер формулы не считает,
      // а в выгрузке и в поиске нужны числа, а не «=СУММ(B2:B10)».
      const evaluator = new Evaluator((row, col) => readRaw(sheet, row, col))
      const order = rowOrder(sheet)

      cellsOf(sheet).forEach((cell, mapKey) => {
        const at = parseKey(mapKey, order)
        if (!at) return
        const { row, col } = at

        const raw = cell.get(KEYS.raw)
        if (raw === undefined || raw === null || raw === '') return

        const format = cell.get(KEYS.format) as NumberFormat | undefined
        cells[cellRef(row, col)] = {
          value: String(raw),
          display: formatValue(evaluator.valueAt(row, col), format ?? 'auto'),
        }
      })

      return {
        id: String(sheet.get('id') ?? ''),
        name: String(sheet.get('name') ?? 'Лист'),
        cells,
      }
    })

  return { kind: 'sheet', sheets }
}

// ------------------------------ Отображение ------------------------------

/**
 * Деньги: сом, юань, доллар, рубль.
 *
 * Берём узкий знак валюты: обычный даёт «CN¥» вместо «¥» и «KGS» вместо знака —
 * в узкой колонке это лишние символы. Сом пишем словом: его знак (⃀) есть
 * не в каждом шрифте и у половины читающих превратился бы в пустой квадрат.
 */
function currencyFormat(currency: string): Intl.NumberFormat {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 2,
  })
}

const CURRENCIES: Record<string, Intl.NumberFormat> = {
  currency: currencyFormat('RUB'),
  currency_cny: currencyFormat('CNY'),
  currency_usd: currencyFormat('USD'),
}

const SOM = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const NUMBER = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const PLAIN = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 10 })

/** Готовит значение к показу: формат ячейки применяется только к числам. */
export function formatValue(value: CellValue, format: NumberFormat = 'auto'): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'ИСТИНА' : 'ЛОЖЬ'
  if (typeof value === 'string') return value

  // Вычислитель бесконечность и NaN наружу больше не отдаёт, но показать
  // «∞ ₽» или «не число» вместо суммы нельзя ни при каких обстоятельствах.
  if (!Number.isFinite(value)) return '#ЧИСЛО!'

  switch (format) {
    case 'number':
      return NUMBER.format(value)
    case 'percent':
      return `${PLAIN.format(value * 100)}%`
    case 'currency_kgs':
      return `${SOM.format(value)} сом`
    case 'currency':
    case 'currency_cny':
    case 'currency_usd':
      return CURRENCIES[format].format(value)
    case 'date':
      // Счёт дней ведётся от той же даты, что и в остальных таблицах.
      return new Date(Date.UTC(1899, 11, 30) + value * 86_400_000).toLocaleDateString('ru-RU')
    case 'text':
      return String(value)
    default:
      return PLAIN.format(value)
  }
}
