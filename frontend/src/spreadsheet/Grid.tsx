/**
 * Сетка листа.
 *
 * Рисуются только видимые строки: лист на пять тысяч строк — это сто тридцать
 * тысяч ячеек, и держать их в DOM нельзя. Заголовки строк и столбцов живут
 * отдельными полосами и сдвигаются вслед за прокруткой, поэтому им не нужны
 * ни sticky, ни собственные полосы прокрутки.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { ColumnTools } from './ColumnTools'
import { Evaluator, colLabel, isError } from './formula'
import {
  DEFAULT_COL_WIDTH,
  HEADER_WIDTH,
  MIN_COL_WIDTH,
  ROW_HEIGHT,
  type SheetMap,
  colCount,
  colWidth,
  formatValue,
  colorRules,
  columnsWithFilter,
  frozen,
  hiddenRows,
  lastFilledRow,
  readRaw,
  readStyle,
  ruleMatches,
  validation,
  rowCount,
  setColWidth,
} from './model'
import { isTransitColumn, transitChoices } from './money'
import { bounds, cellAt, contains, type Cell, type Selection } from './selection'
import { formatVia, isRoutePointColumn, parseVia, viaColumn } from './routing'
import { deadlineTone, isDeadlineHeader, isSettled, parseDeadline, statusTone } from './statuses'
import { useRoutes } from '@/store/routes'
import { useIsDarkTheme } from '@/utils/theme'

type Props = {
  doc: Y.Doc
  sheet: SheetMap
  /** Меняется на каждое обновление документа — сигнал пересчитать значения. */
  version: number
  editable: boolean
  selection: Selection
  onSelectionChange: (selection: Selection) => void
  onCommit: (row: number, col: number, raw: string) => void
  onClear: (cells: Cell[]) => void
  onPaste: (row: number, col: number, rows: string[][]) => void
  /** Строка формул сообщает сюда, что правку начали не в сетке. */
  editRequest: number
  /** Ячейки, найденные поиском по листу: подсвечиваются все сразу. */
  matches?: { row: number; col: number }[]
}

/** Пустой набор скрытых строк — общий, чтобы не плодить объекты. */
const EMPTY_ROWS: Set<number> = new Set()

const OVERSCAN = 6

/**
 * Ячейка для буфера обмена.
 *
 * Табуляция и перевод строки внутри значения — это разделители таблицы, и без
 * кавычек такая ячейка при вставке разъезжалась на несколько столбцов. Правило
 * взято из таблиц: значение в кавычках, внутренняя кавычка удваивается.
 */
function quoteCell(value: string): string {
  if (!/[\t\n\r"]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

/** Разбор вставленного с учётом тех же кавычек. */
function parseClipboard(text: string): string[][] {
  const source = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  const rows: string[][] = []

  let row: string[] = []
  let cell = ''
  let quoted = false
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"'
          index += 2
          continue
        }
        quoted = false
        index += 1
        continue
      }
      cell += char
      index += 1
      continue
    }

    if (char === '"' && cell === '') {
      quoted = true
      index += 1
      continue
    }
    if (char === '\t') {
      row.push(cell)
      cell = ''
      index += 1
      continue
    }
    if (char === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      index += 1
      continue
    }

    cell += char
    index += 1
  }

  row.push(cell)
  rows.push(row)
  return rows
}

export function Grid({
  doc,
  sheet,
  version,
  editable,
  selection,
  onSelectionChange,
  onCommit,
  onClear,
  onPaste,
  editRequest,
  matches,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colStripRef = useRef<HTMLDivElement>(null)
  const rowStripRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Правка уже записана: защита от повторного завершения при потере фокуса.
  const finished = useRef(false)

  const [viewport, setViewport] = useState({ top: 0, left: 0, height: 600, width: 800 })
  const [editing, setEditing] = useState<{ row: number; col: number; value: string } | null>(null)
  const [resizing, setResizing] = useState<{ col: number; width: number } | null>(null)

  const rows = rowCount(sheet)
  const cols = colCount(sheet)

  // Смещения столбцов считаем один раз на изменение ширин: по ним ищется
  // и попадание курсора, и левая граница каждой видимой ячейки.
  const offsets = useMemo(() => {
    const list = [0]
    for (let col = 0; col < cols; col += 1) {
      const width = resizing?.col === col ? resizing.width : colWidth(sheet, col)
      list.push(list[col] + width)
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, cols, version, resizing])

  const totalWidth = offsets[cols]

  const evaluator = useMemo(
    () => new Evaluator((row, col) => readRaw(sheet, row, col)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, version],
  )

  // Показанное значение ячейки: по нему работает фильтр и правила подсветки.
  // В колонке с формулой человек выбирает из того, что видит, а не из «=C2*D2».
  const displayAt = useCallback(
    (row: number, col: number) => {
      const raw = readRaw(sheet, row, col)
      if (raw === null) return ''
      return formatValue(evaluator.valueAt(row, col), readStyle(sheet, row, col).format)
    },
    [sheet, evaluator],
  )

  /**
   * Строки, скрытые фильтром.
   *
   * Без фильтра не делаем ничего: поиск последней заполненной строки обходит
   * всю книгу, и на полсотни тысяч строк это полторы сотни миллисекунд — на
   * каждое нажатие клавиши. Пока отбор не включён, скрывать нечего.
   */
  const hidden = useMemo(() => {
    if (columnsWithFilter(sheet).length === 0) return EMPTY_ROWS
    return hiddenRows(sheet, displayAt, Math.min(lastFilledRow(sheet), rows - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, version, rows, displayAt])

  /**
   * Смещения строк сверху.
   *
   * Пока фильтра нет — а это обычная работа — положение строки считается
   * умножением, без единого массива. Это важно для больших журналов: держать
   * и пересчитывать массив на сотню тысяч строк ради умножения на 24 незачем.
   *
   * Как только фильтр включён, скрытые строки занимают ноль, соседние
   * смыкаются, и умножение уже не годится — тогда строится таблица смещений.
   */
  const rowTops = useMemo(() => {
    if (hidden.size === 0) return null
    const list = new Int32Array(rows + 1)
    for (let row = 0; row < rows; row += 1) {
      list[row + 1] = list[row] + (hidden.has(row) ? 0 : ROW_HEIGHT)
    }
    return list
  }, [rows, hidden])

  const rowTop = useCallback(
    (row: number) => (rowTops ? rowTops[Math.max(0, Math.min(row, rows))] : row * ROW_HEIGHT),
    [rowTops, rows],
  )

  const rowHeightAt = (row: number) => (hidden.has(row) ? 0 : ROW_HEIGHT)
  const totalHeight = rowTop(rows)

  /** Номер строки по смещению сверху. */
  const rowAtOffset = useCallback((offset: number) => {
    if (!rowTops) return Math.max(0, Math.floor(offset / ROW_HEIGHT))

    let low = 0
    let high = rowTops.length - 2
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (rowTops[middle] <= offset) low = middle
      else high = middle - 1
    }
    return low
  }, [rowTops])

  // Закрепление: эти строки и столбцы не уезжают при прокрутке.
  const freeze = useMemo(() => frozen(sheet), [sheet, version])

  const places = useRoutes((state) => state.places)
  const transitAmounts = useRoutes((state) => state.transitAmounts)

  /**
   * Что предложить на выбор в ячейке, которую сейчас правят.
   *
   * Свой список столбца — главнее: его завели под эту таблицу. Если его нет,
   * а столбец называется «Откуда» или «Куда», подставляем точки из общего
   * справочника — те самые, между которыми известно время в пути.
   */
  const choices = useMemo(() => {
    if (!editing || editing.row <= 0) return null

    const own = validation(sheet, editing.col)
    if (own) return own

    if (places.length > 0 && isRoutePointColumn(sheet, editing.col)) {
      return places.map((place) => place.name)
    }

    // «Транзит» берут не любой: суммы оговорены заранее и лежат в общем
    // справочнике. Свой список столбца, если он задан, важнее этого.
    if (isTransitColumn(sheet, editing.col)) {
      return transitChoices(transitAmounts)
    }
    return null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, sheet, version, places, transitAmounts])

  /**
   * Точки по пути: выбор сразу нескольких.
   *
   * Через одну точку рейс идёт редко — обычно это Кашгар, потом Нарын, потом
   * граница. Одиночный список заставлял бы дописывать стрелки руками, поэтому
   * здесь галочки, а ячейка собирается из отмеченного.
   */
  const viaChoices = useMemo(() => {
    if (!editing || editing.row <= 0 || places.length === 0) return null
    if (viaColumn(sheet) !== editing.col) return null
    return places.map((place) => place.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, sheet, version, places])

  const viaSelected = useMemo(
    () => new Set(editing ? parseVia(editing.value) : []),
    [editing],
  )

  const toggleVia = (name: string) => {
    if (!editing) return
    const chosen = parseVia(editing.value)
    const next = chosen.includes(name)
      ? chosen.filter((item) => item !== name)
      : [...chosen, name]
    setEditing({ ...editing, value: formatVia(next) })
  }

  // Свои правила подсветки. Пустой список — обычная работа без них.
  const rules = useMemo(() => colorRules(sheet), [sheet, version])

  const firstRow = Math.max(0, rowAtOffset(viewport.top) - OVERSCAN)
  const lastRow = Math.min(rows - 1, rowAtOffset(viewport.top + viewport.height) + OVERSCAN)

  const firstCol = Math.max(0, offsets.findIndex((value) => value > viewport.left) - 1 - OVERSCAN)
  const lastColRaw = offsets.findIndex((value) => value > viewport.left + viewport.width)
  const lastCol = Math.min(cols - 1, (lastColRaw === -1 ? cols : lastColRaw) + OVERSCAN)

  const syncViewport = useCallback(() => {
    const element = scrollRef.current
    if (!element) return

    if (colStripRef.current) {
      colStripRef.current.style.transform = `translateX(${-element.scrollLeft}px)`
    }
    if (rowStripRef.current) {
      rowStripRef.current.style.transform = `translateY(${-element.scrollTop}px)`
    }

    setViewport((previous) => {
      const next = {
        top: element.scrollTop,
        left: element.scrollLeft,
        height: element.clientHeight,
        width: element.clientWidth,
      }
      // Перерисовываем, только если сдвиг мог поменять набор видимых ячеек.
      const sameRow = Math.floor(previous.top / ROW_HEIGHT) === Math.floor(next.top / ROW_HEIGHT)
      const sameSize = previous.height === next.height && previous.width === next.width
      if (sameRow && sameSize && Math.abs(previous.left - next.left) < MIN_COL_WIDTH) {
        return previous
      }
      return next
    })
  }, [])

  useLayoutEffect(syncViewport, [syncViewport])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(syncViewport)
    observer.observe(element)
    return () => observer.disconnect()
  }, [syncViewport])

  // ----------------------------- Правка ячейки -----------------------------

  const startEditing = useCallback(
    (row: number, col: number, initial?: string) => {
      if (!editable) return
      finished.current = false
      setEditing({ row, col, value: initial ?? readRaw(sheet, row, col) ?? '' })
    },
    [editable, sheet],
  )

  useEffect(() => {
    if (editRequest > 0) {
      startEditing(selection.focus.row, selection.focus.col)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequest])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  /**
   * Закрывает правку и записывает значение.
   *
   * `value` передаётся, когда значение выбрано из списка: записать его
   * отдельным вызовом нельзя — уход фокуса из поля тут же вызывал бы это же
   * завершение с пустым содержимым поля и затирал бы выбранное.
   */
  const finishEditing = (move: 'down' | 'right' | 'none' = 'none', value?: string) => {
    if (!editing || finished.current) return
    // Закрытие поля само вызывает это завершение ещё раз — уже с пустым
    // содержимым и со старым значением в замыкании. Без отметки выбранное
    // из списка тут же затиралось пустотой.
    finished.current = true
    onCommit(editing.row, editing.col, value ?? editing.value)
    setEditing(null)

    if (move === 'down') selectCell(Math.min(editing.row + 1, rows - 1), editing.col)
    else if (move === 'right') selectCell(editing.row, Math.min(editing.col + 1, cols - 1))

    scrollRef.current?.focus()
  }

  // Тёмная тема меняет заливку статусов: светлая плашка на тёмном листе
  // слепит. Через подписку, а не чтением класса в отрисовке: заливка ячеек
  // задаётся вычисленным цветом, и без неё таблица оставалась в прежней
  // палитре до первой посторонней перерисовки.
  const isDark = useIsDarkTheme()

  // Срок истекает сам по себе, без чьей-либо правки, поэтому таблица
  // пересчитывает цвета по минуте. Реже — и красное появится с опозданием,
  // чаще — перерисовка ради секунд, которых не видно.
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Колонки со сроком узнаются по заголовку: «Прибытие», «Срок», «到达».
  // Без этого покраснела бы и колонка «Дата» — она всегда в прошлом.
  const deadlineCols = useMemo(() => {
    const columns = new Set<number>()
    for (let col = 0; col < cols; col += 1) {
      if (isDeadlineHeader(readRaw(sheet, 0, col))) columns.add(col)
    }
    return columns
  }, [sheet, cols, version])

  // Закрытые строки: в них где-то стоит «Готово» или «Отменён». Считаем один
  // раз на видимый участок, а не на каждую ячейку со сроком.
  const settledRows = useMemo(() => {
    const settled = new Set<number>()
    if (deadlineCols.size === 0) return settled

    for (let row = firstRow; row <= lastRow; row += 1) {
      const values: (string | null)[] = []
      for (let col = 0; col < cols; col += 1) values.push(readRaw(sheet, row, col))
      if (isSettled(values)) settled.add(row)
    }
    return settled
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, cols, version, deadlineCols, firstRow, lastRow])

  // Ключи найденных ячеек — искать в массиве на каждую клетку слишком дорого.
  const matchKeys = useMemo(
    () => new Set((matches ?? []).map((cell) => `${cell.row}:${cell.col}`)),
    [matches],
  )

  /**
   * Строки с найденным. Подсвечивается вся строка, а не одна ячейка: ищут
   * рейс, а не клетку, и видеть нужно его целиком — куда идёт, когда вышел,
   * что с ним. Одна жёлтая клетка среди двадцати этого не показывает.
   */
  const matchRows = useMemo(
    () => new Set((matches ?? []).map((cell) => cell.row)),
    [matches],
  )

  // --------------------------- Перемещение курсора ---------------------------

  const revealCell = (row: number, col: number) => {
    const element = scrollRef.current
    if (!element) return

    const top = rowTop(row)
    const height = rowHeightAt(row)
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + height > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + height - element.clientHeight
    }

    const left = offsets[col]
    const width = offsets[col + 1] - left
    if (left < element.scrollLeft) element.scrollLeft = left
    else if (left + width > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = left + width - element.clientWidth
    }
  }

  const selectCell = (row: number, col: number) => {
    const clampedRow = Math.max(0, Math.min(row, rows - 1))
    const clampedCol = Math.max(0, Math.min(col, cols - 1))
    onSelectionChange(cellAt(clampedRow, clampedCol))
    revealCell(clampedRow, clampedCol)
  }

  // Поиск по листу двигает выделение снаружи. Без этого найденная ячейка
  // оставалась бы за краем экрана, а человек видел бы прежнее место.
  useEffect(() => {
    revealCell(selection.focus.row, selection.focus.col)
    // Прокрутка нужна на смену ячейки, а не на изменение ширины столбцов.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection.focus.row, selection.focus.col])

  const extendTo = (row: number, col: number) => {
    const clampedRow = Math.max(0, Math.min(row, rows - 1))
    const clampedCol = Math.max(0, Math.min(col, cols - 1))
    onSelectionChange({ anchor: selection.anchor, focus: { row: clampedRow, col: clampedCol } })
    revealCell(clampedRow, clampedCol)
  }

  // ------------------------------ Клавиатура ------------------------------

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return

    const { row, col } = selection.focus
    const shift = event.shiftKey
    const step = shift ? extendTo : selectCell

    switch (event.key) {
      case 'ArrowUp': event.preventDefault(); step(row - 1, col); return
      case 'ArrowDown': event.preventDefault(); step(row + 1, col); return
      case 'ArrowLeft': event.preventDefault(); step(row, col - 1); return
      case 'ArrowRight': event.preventDefault(); step(row, col + 1); return
      case 'Home': event.preventDefault(); step(row, 0); return
      case 'End': event.preventDefault(); step(row, cols - 1); return
      case 'PageDown': event.preventDefault(); step(row + 20, col); return
      case 'PageUp': event.preventDefault(); step(row - 20, col); return
      case 'Tab':
        event.preventDefault()
        selectCell(row, col + (shift ? -1 : 1))
        return
      case 'Enter':
      case 'F2':
        event.preventDefault()
        startEditing(row, col)
        return
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        if (editable) onClear(cellsInSelection())
        return
      case 'Escape':
        onSelectionChange(cellAt(row, col))
        return
      default:
        break
    }

    // Печатаемый символ заменяет содержимое — как в любой таблице.
    if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.length === 1) {
      event.preventDefault()
      startEditing(row, col, event.key)
    }
  }

  const cellsInSelection = (): Cell[] => {
    const rect = bounds(selection)
    const list: Cell[] = []
    for (let row = rect.top; row <= rect.bottom; row += 1) {
      for (let col = rect.left; col <= rect.right; col += 1) list.push({ row, col })
    }
    return list
  }

  // ------------------------------ Буфер обмена ------------------------------

  const handleCopy = (event: React.ClipboardEvent) => {
    if (editing) return
    const rect = bounds(selection)
    const lines: string[] = []

    for (let row = rect.top; row <= rect.bottom; row += 1) {
      const line: string[] = []
      for (let col = rect.left; col <= rect.right; col += 1) {
        // Копируется введённое, а не посчитанное: внутри книги формула
        // должна переноситься формулой.
        line.push(quoteCell(readRaw(sheet, row, col) ?? ''))
      }
      lines.push(line.join('\t'))
    }

    event.clipboardData.setData('text/plain', lines.join('\n'))
    event.preventDefault()
  }

  const handlePaste = (event: React.ClipboardEvent) => {
    if (editing || !editable) return
    const text = event.clipboardData.getData('text/plain')
    if (!text) return

    event.preventDefault()
    onPaste(selection.focus.row, selection.focus.col, parseClipboard(text))
  }

  const handleCut = (event: React.ClipboardEvent) => {
    if (editing || !editable) return
    handleCopy(event)
    onClear(cellsInSelection())
  }

  // ----------------------------- Мышь по сетке -----------------------------

  const dragging = useRef(false)

  const cellFromPoint = (clientX: number, clientY: number): Cell | null => {
    const element = scrollRef.current
    if (!element) return null

    const box = element.getBoundingClientRect()
    const x = clientX - box.left + element.scrollLeft
    const y = clientY - box.top + element.scrollTop

    const row = rowAtOffset(y)
    if (row < 0 || row >= rows) return null

    let col = -1
    for (let index = 0; index < cols; index += 1) {
      if (x >= offsets[index] && x < offsets[index + 1]) {
        col = index
        break
      }
    }
    if (col === -1) return null

    return { row, col }
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    const cell = cellFromPoint(event.clientX, event.clientY)
    if (!cell) return

    if (editing) finishEditing()
    scrollRef.current?.focus()

    if (event.shiftKey) extendTo(cell.row, cell.col)
    else {
      dragging.current = true
      onSelectionChange(cellAt(cell.row, cell.col))
    }
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!dragging.current) return
    const cell = cellFromPoint(event.clientX, event.clientY)
    if (cell) onSelectionChange({ anchor: selection.anchor, focus: cell })
  }

  const stopDragging = () => {
    dragging.current = false
  }

  const handleDoubleClick = (event: React.MouseEvent) => {
    const cell = cellFromPoint(event.clientX, event.clientY)
    if (cell) startEditing(cell.row, cell.col)
  }

  // --------------------------- Ширина столбца ---------------------------

  useEffect(() => {
    if (!resizing) return

    const move = (event: PointerEvent) => {
      const element = scrollRef.current
      if (!element) return
      const box = element.getBoundingClientRect()
      const x = event.clientX - box.left + element.scrollLeft
      setResizing({ col: resizing.col, width: Math.max(MIN_COL_WIDTH, x - offsets[resizing.col]) })
    }

    const up = () => {
      setColWidth(doc, sheet, resizing.col, resizing.width)
      setResizing(null)
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [resizing, doc, sheet, offsets])

  // -------------------------------- Разметка --------------------------------

  const rect = bounds(selection)

  const visibleRows: number[] = []
  // Закреплённые строки видны всегда, даже когда лист прокручен далеко вниз.
  for (let row = 0; row < freeze.rows && row < rows; row += 1) {
    if (!hidden.has(row)) visibleRows.push(row)
  }
  for (let row = Math.max(firstRow, freeze.rows); row <= lastRow; row += 1) {
    if (!hidden.has(row)) visibleRows.push(row)
  }

  const visibleCols: number[] = []
  for (let col = 0; col < freeze.cols && col < cols; col += 1) visibleCols.push(col)
  for (let col = Math.max(firstCol, freeze.cols); col <= lastCol; col += 1) visibleCols.push(col)

  /**
   * Положение ячейки с учётом закрепления.
   *
   * Закреплённая строка едет вместе с прокруткой ровно настолько, насколько
   * лист уехал вверх, — и потому остаётся на месте. Приём работает внутри той
   * же области прокрутки, так что закреплённая шапка остаётся живой: по ней
   * можно щёлкнуть, выделить и править.
   */
  const cellTop = (row: number) =>
    row < freeze.rows ? viewport.top + rowTop(row) : rowTop(row)
  const cellLeft = (col: number) =>
    col < freeze.cols ? viewport.left + offsets[col] : offsets[col]
  const cellLayer = (row: number, col: number) => {
    if (row < freeze.rows && col < freeze.cols) return 3
    if (row < freeze.rows || col < freeze.cols) return 2
    return undefined
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {/* Полоса с буквами столбцов */}
      <div className="flex border-b border-hairline">
        <div
          className="shrink-0 border-r border-hairline bg-surface-muted"
          style={{ width: HEADER_WIDTH, height: ROW_HEIGHT }}
        />
        <div className="relative flex-1 overflow-hidden" style={{ height: ROW_HEIGHT }}>
          <div ref={colStripRef} className="absolute inset-y-0 left-0" style={{ width: totalWidth }}>
            {visibleCols.map((col) => (
              <div
                key={col}
                className={[
                  'absolute top-0 flex h-full items-center justify-center',
                  'border-r border-hairline text-xs select-none',
                  col >= rect.left && col <= rect.right
                    ? 'bg-accent/15 font-semibold text-ink'
                    : 'bg-surface-muted text-ink-muted',
                ].join(' ')}
                style={{ left: offsets[col], width: offsets[col + 1] - offsets[col] }}
                onClick={() =>
                  onSelectionChange({ anchor: { row: 0, col }, focus: { row: rows - 1, col } })
                }
              >
                {colLabel(col)}
                {/* Действия столбца — рядом с его буквой: сортировка,
                    фильтр, список значений, своё правило подсветки.

                    Нажатие не должно дойти до заголовка: тот выделяет весь
                    столбец до последней строки, а выделение последней строки
                    растит лист на сотню строк и уводит прокрутку вниз. */}
                <span
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <ColumnTools
                    doc={doc}
                    sheet={sheet}
                    col={col}
                    version={version}
                    editable={editable}
                    display={displayAt}
                  />
                </span>
                <span
                  role="separator"
                  aria-label={`Ширина столбца ${colLabel(col)}`}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                    setResizing({ col, width: offsets[col + 1] - offsets[col] })
                  }}
                  className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Полоса с номерами строк */}
        <div
          className="relative shrink-0 overflow-hidden border-r border-hairline bg-surface-muted"
          style={{ width: HEADER_WIDTH }}
        >
          <div ref={rowStripRef} className="absolute inset-x-0 top-0" style={{ height: totalHeight }}>
            {visibleRows.map((row) => (
              <div
                key={row}
                className={[
                  'absolute inset-x-0 flex items-center justify-center',
                  'border-b border-hairline text-xs select-none',
                  row >= rect.top && row <= rect.bottom
                    ? 'bg-accent/15 font-semibold text-ink'
                    : 'text-ink-muted',
                ].join(' ')}
                style={{
                  top: cellTop(row),
                  height: rowHeightAt(row),
                  zIndex: row < freeze.rows ? 2 : undefined,
                  background: row < freeze.rows ? 'rgb(var(--surface-muted))' : undefined,
                }}
                onClick={() =>
                  onSelectionChange({ anchor: { row, col: 0 }, focus: { row, col: cols - 1 } })
                }
              >
                {row + 1}
              </div>
            ))}
          </div>
        </div>

        {/* Сама сетка */}
        <div
          ref={scrollRef}
          tabIndex={0}
          role="grid"
          aria-label="Лист"
          aria-rowcount={rows}
          aria-colcount={cols}
          onScroll={syncViewport}
          onKeyDown={handleKeyDown}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={stopDragging}
          onPointerLeave={stopDragging}
          onDoubleClick={handleDoubleClick}
          onCopy={handleCopy}
          onCut={handleCut}
          onPaste={handlePaste}
          className="relative flex-1 overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <div className="relative" style={{ width: totalWidth, height: totalHeight }}>
            {visibleRows.map((row) =>
              visibleCols.map((col) => {
                const raw = readRaw(sheet, row, col)
                const style = readStyle(sheet, row, col)
                const value = raw === null ? null : evaluator.valueAt(row, col)
                const text = formatValue(value, style.format)
                const selected = contains(selection, row, col)
                const isFocus = selection.focus.row === row && selection.focus.col === col
                const found = matchKeys.has(`${row}:${col}`)
                const inFoundRow = matchRows.has(row)
                const numeric = typeof value === 'number'
                // Цвет по смыслу: сначала слово, потом срок. Ручная заливка
                // сильнее обоих — её выбрал человек.
                let tone = style.background ? null : statusTone(text)
                if (!tone && !style.background && deadlineCols.has(col) && row > 0) {
                  const deadline = parseDeadline(text, now)
                  if (deadline) tone = deadlineTone(deadline, now, settledRows.has(row))
                }

                // Своё правило сильнее подсказки по смыслу: его задали руками
                // и под свою таблицу. Шапку правила не красят.
                const rule = row > 0 && !style.background
                  ? rules.find((item) => item.col === col && ruleMatches(item, text))
                  : undefined

                return (
                  <div
                    key={`${row}:${col}`}
                    role="gridcell"
                    aria-selected={selected}
                    className={[
                      'absolute overflow-hidden whitespace-nowrap border-b border-r',
                      'border-hairline px-1.5 text-sm leading-6 transition-colors',
                      found ? 'bg-amber-200/70 dark:bg-amber-500/30' : '',
                      // Вся строка найденного — светлее самой ячейки: видно
                      // и строку целиком, и место, где совпало.
                      inFoundRow && !found ? 'bg-amber-100/80 dark:bg-amber-500/15' : '',
                      selected && !isFocus && !found && !inFoundRow ? 'bg-accent/10' : '',
                      isError(value) ? 'text-rose-600 dark:text-rose-400' : '',
                      style.bold ? 'font-semibold' : '',
                      style.italic ? 'italic' : '',
                      style.underline ? 'underline' : '',
                    ].join(' ')}
                    style={{
                      top: cellTop(row),
                      left: cellLeft(col),
                      zIndex: cellLayer(row, col),
                      width: offsets[col + 1] - offsets[col],
                      height: rowHeightAt(row),
                      // Числа прижимаются вправо, текст влево — если человек
                      // не выбрал выравнивание сам.
                      textAlign: style.align ?? (numeric ? 'right' : 'left'),
                      color: style.color
                        ?? rule?.color
                        ?? (tone ? (isDark ? tone.darkColor : tone.color) : undefined),
                      // В найденной строке своя заливка уступает подсветке:
                      // иначе покрашенные ячейки остались бы неотличимыми,
                      // и строка не читалась бы как найденная.
                      background: inFoundRow
                        ? undefined
                        : rule?.background
                          ?? (tone ? (isDark ? tone.darkBackground : tone.background) : style.background),
                    }}
                  >
                    {text}
                  </div>
                )
              }),
            )}

            {/* Рамка выделения поверх ячеек */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute border-2 border-accent"
              style={{
                top: rowTop(rect.top),
                left: offsets[rect.left],
                width: offsets[rect.right + 1] - offsets[rect.left],
                height: rowTop(Math.min(rect.bottom + 1, rows)) - rowTop(rect.top),
              }}
            />

            {editing && (
              <input
                ref={inputRef}
                value={editing.value}
                aria-label="Значение ячейки"
                onChange={(event) => setEditing({ ...editing, value: event.target.value })}
                onBlur={() => finishEditing()}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    finishEditing('down')
                  } else if (event.key === 'Tab') {
                    event.preventDefault()
                    finishEditing('right')
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    setEditing(null)
                    scrollRef.current?.focus()
                  }
                }}
                // cell-input: на телефоне поля крупнее, чтобы браузер не
                // увеличивал страницу, но в строку высотой 24 пикселя такой
                // шрифт не влезает — эта помечена как исключение.
                className="cell-input absolute z-10 border-2 border-accent bg-surface px-1.5 text-sm outline-none"
                style={{
                  top: cellTop(editing.row),
                  left: cellLeft(editing.col),
                  width: Math.max(offsets[editing.col + 1] - offsets[editing.col], DEFAULT_COL_WIDTH),
                  height: ROW_HEIGHT,
                  zIndex: 10,
                }}
              />
            )}

            {/* Выбор из списка значений: столбцу задали набор допустимых,
                и статус теперь не набирают, а выбирают — без опечаток,
                из-за которых строка не красится. */}
            {editing && viaChoices && (
              <div
                className="absolute z-20 max-h-56 w-56 overflow-y-auto rounded-xl border border-hairline bg-surface py-1 shadow-lg"
                style={{
                  top: cellTop(editing.row) + ROW_HEIGHT,
                  left: cellLeft(editing.col),
                }}
                // Нажатие не должно доходить до сетки: она переносит выделение
                // и закрывает правку, не дав отметить вторую точку.
                onPointerDown={(event) => event.stopPropagation()}
              >
                <div className="px-3 py-1 text-xs text-ink-muted">
                  Точки по пути — отметьте нужные
                </div>
                {viaChoices.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      toggleVia(name)
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted"
                  >
                    <span
                      aria-hidden="true"
                      className={[
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px]',
                        viaSelected.has(name)
                          ? 'border-accent bg-accent text-white'
                          : 'border-hairline',
                      ].join(' ')}
                    >
                      {viaSelected.has(name) ? '✓' : ''}
                    </span>
                    {name}
                  </button>
                ))}
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    finishEditing()
                  }}
                  className="mt-1 w-full border-t border-hairline px-3 py-2 text-left text-sm font-medium text-accent"
                >
                  Готово
                </button>
              </div>
            )}

            {editing && !viaChoices && choices && (
              <div
                className="absolute z-20 max-h-48 min-w-32 overflow-y-auto rounded-xl border border-hairline bg-surface py-1 shadow-lg"
                style={{
                  top: cellTop(editing.row) + ROW_HEIGHT,
                  left: cellLeft(editing.col),
                  minWidth: Math.max(offsets[editing.col + 1] - offsets[editing.col], 140),
                }}
              >
                {choices.map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    /**
                     * Записываем на нажатии указателя и гасим событие.
                     *
                     * Сетка слушает pointerdown и на любое нажатие переносит
                     * выделение, закрывая правку. Её обработчик срабатывает
                     * раньше щелчка по кнопке, поэтому выбор из списка
                     * «проваливался» в таблицу: курсор прыгал на другую
                     * строку, а значение не записывалось вовсе.
                     */
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      finishEditing('none', choice)
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-ink hover:bg-surface-muted"
                  >
                    {choice}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
