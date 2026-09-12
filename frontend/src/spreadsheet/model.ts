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

      const cells = cellsOf(sheet)
      for (const [ref, raw] of Object.entries(item.cells ?? {})) {
        const address = parseRef(ref)
        // Адрес за пределами листа пропускаем молча только здесь: содержимое
        // приходит из базы, и падать на одной кривой ячейке шаблона нельзя.
        if (!address) continue
        if (address.row >= MAX_ROWS || address.col >= MAX_COLS) continue

        // В базе ячейка — это {value, display}: value введено человеком,
        // display посчитан. Формулы пересчитает редактор, поэтому берём value.
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
  })
  return true
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

/** Разрешённые значения столбца. Пусто — фильтр по нему не стоит. */
export function columnFilter(sheet: SheetMap, col: number): string[] | null {
  const all = sheet.get('filters') as Record<string, string[]> | undefined
  const values = all?.[String(col)]
  return Array.isArray(values) ? values : null
}

export function columnsWithFilter(sheet: SheetMap): number[] {
  const all = sheet.get('filters') as Record<string, string[]> | undefined
  if (!all) return []
  return Object.keys(all).map(Number).filter((col) => Number.isInteger(col))
}

export function setColumnFilter(doc: Y.Doc, sheet: SheetMap,
                                col: number, values: string[] | null): void {
  const all = { ...((sheet.get('filters') as Record<string, string[]>) ?? {}) }
  if (values === null) delete all[String(col)]
  else all[String(col)] = values
  doc.transact(() => sheet.set('filters', all))
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
      const allowed = columnFilter(sheet, col)
      if (!allowed) continue
      if (!allowed.includes(display(row, col))) {
        hidden.add(row)
        break
      }
    }
  }
  return hidden
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
 * Переставляются идентификаторы строк, а не содержимое: ячейки опознаются по
 * идентификатору и едут за своей строкой сами. Формулы внутри переехавшей
 * строки переписываются на новое место — «=E2*F2» из второй строки в пятой
 * становится «=E5*F5», как при протягивании.
 *
 * Строки вне участка from..to не трогаются: шапка сверху и итог снизу должны
 * остаться там, где стояли.
 */
export function sortRows(doc: Y.Doc, sheet: SheetMap, col: number,
                         direction: 'asc' | 'desc', from: number, to: number): void {
  const rows = rowsArray(sheet)
  if (!rows) return

  const first = Math.max(0, Math.trunc(from))
  const last = Math.min(rows.length - 1, Math.trunc(to))
  if (last <= first) return

  const items: Array<{ id: string; row: number; text: string }> = []
  for (let row = first; row <= last; row += 1) {
    const id = rows.get(row)
    if (id === undefined) return
    items.push({ id, row, text: (readRaw(sheet, row, col) ?? '').trim() })
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

  doc.transact(() => {
    rows.delete(first, items.length)
    rows.insert(first, sorted.map((item) => item.id))

    const cells = cellsOf(sheet)
    sorted.forEach((item, index) => {
      const target = first + index
      if (target === item.row) return
      cells.forEach((cell, mapKey) => {
        if (mapKey.slice(0, mapKey.indexOf(':')) !== item.id) return
        const raw = cell.get(KEYS.raw)
        if (typeof raw !== 'string' || !raw.startsWith('=')) return
        const next = shiftFormulaToRow(raw, item.row, target)
        if (next !== raw) cell.set(KEYS.raw, next)
      })
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
