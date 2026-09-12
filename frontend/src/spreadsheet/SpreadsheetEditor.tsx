/**
 * Редактор электронной таблицы.
 *
 * Соединение, автосохранение, история и присутствие — те же, что у текстового
 * документа: книга живёт в общем документе Yjs, поэтому совместная правка,
 * работа без сети и восстановление версий достались ей даром.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { tokens } from '@/api'
import { DocumentProvider } from '@/websocket/provider'
import type { Document, EditorMode, Presence, SaveStatus } from '@/types'
import { Grid } from './Grid'
import { SheetFind } from './SheetFind'
import { SheetTabs } from './SheetTabs'
import { AddRowDialog } from './AddRowDialog'
import { ChartsDialog } from './ChartsDialog'
import { SpreadsheetToolbar } from './SpreadsheetToolbar'
import { Evaluator, cellRef } from './formula'
import {
  type CellStyle,
  MAX_COLS,
  MAX_ROWS,
  formatValue,
  applyStyle,
  book,
  addSheet,
  clearCells,
  colCount,
  deleteCol,
  deleteRow,
  ensureBook,
  growCols,
  isBookEmpty,
  growRows,
  insertCol,
  insertRow,
  readRaw,
  readStyle,
  type CellHit,
  removeSheet,
  renameSheet,
  rowCount,
  serializeBook,
  frozen,
  seedBook,
  setFrozen,
  sheetAt,
  sheetList,
  writeCell,
} from './model'
import { bounds, cellAt, cells as cellsOfSelection, label, type Cell, type Selection } from './selection'

type Props = {
  document: Document
  token: string
  linkToken?: string
  user: Presence
  mode: EditorMode
  onStatusChange: (status: SaveStatus) => void
  onPresenceChange: (users: Presence[]) => void
  onEvent?: (event: Record<string, unknown>) => void
}

export function SpreadsheetEditor(props: Props) {
  const { document: doc, token, linkToken, user, onStatusChange, onPresenceChange, onEvent } = props
  const [provider, setProvider] = useState<DocumentProvider | null>(null)

  // Снимок для сервера берётся из документа Yjs, а он появляется вместе
  // с провайдером — ссылка разрывает эту зависимость по кругу.
  const bookRef = useRef<Y.Doc | null>(null)

  useEffect(() => {
    const instance = new DocumentProvider({
      documentId: doc.id,
      token,
      // Токен читается на каждое подключение: тот, что был при открытии
      // вкладки, через полчаса уже не годится.
      getToken: () => tokens.access,
      linkToken,
      user,
      onStatus: onStatusChange,
      onPresence: onPresenceChange,
      onEvent,
      getContent: () => (bookRef.current ? serializeBook(bookRef.current) : null),
      // Таблица из шаблона и книга, перенесённая из файла, лежат в базе
      // обычным JSON. Если состояния Yjs ещё нет, переносим их в книгу —
      // иначе документ открывается пустым, хотя содержимое у него есть.
      onReady: (hasState) => {
        const target = bookRef.current
        if (!target || hasState || !isBookEmpty(target)) return
        if (seedBook(target, doc.content)) instance.flush()
      },
    })
    bookRef.current = instance.doc
    setProvider(instance)

    const flush = () => instance.flush()
    window.addEventListener('beforeunload', flush)

    return () => {
      window.removeEventListener('beforeunload', flush)
      instance.destroy()
      setProvider(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, token, linkToken])

  if (!provider) {
    return (
      <p className="p-12 text-center text-ink-muted" role="status">
        Подключение к таблице…
      </p>
    )
  }

  return <Workbook {...props} provider={provider} />
}

function Workbook({ mode, provider }: Props & { provider: DocumentProvider }) {
  const doc = provider.doc
  const editable = mode === 'editing'

  const [version, setVersion] = useState(0)
  const [active, setActive] = useState(0)
  const [selection, setSelection] = useState<Selection>(cellAt(0, 0))
  const [editRequest, setEditRequest] = useState(0)
  const [formulaDraft, setFormulaDraft] = useState<string | null>(null)
  const [finding, setFinding] = useState(false)
  const [adding, setAdding] = useState(false)
  const [charting, setCharting] = useState(false)
  const [matches, setMatches] = useState<CellHit[]>([])

  // Книга должна существовать до первой отрисовки сетки: пустой массив листов
  // не из чего рисовать.
  useMemo(() => ensureBook(doc), [doc])

  useEffect(() => {
    const bump = () => setVersion((value) => value + 1)
    doc.on('update', bump)
    return () => doc.off('update', bump)
  }, [doc])

  // Отменяются только свои правки: чужие приходят с пометкой 'remote',
  // а UndoManager по умолчанию следит лишь за местными изменениями.
  const undoManager = useMemo(() => new Y.UndoManager(book(doc)), [doc])
  useEffect(() => () => undoManager.destroy(), [undoManager])

  const sheets = sheetList(doc)
  const index = Math.min(active, Math.max(sheets.length - 1, 0))
  const sheet = sheetAt(doc, index)

  const focusRaw = sheet ? readRaw(sheet, selection.focus.row, selection.focus.col) : null
  const focusStyle: CellStyle = sheet
    ? readStyle(sheet, selection.focus.row, selection.focus.col)
    : {}

  // Пока строку формул не трогали, в ней показывается содержимое ячейки.
  useEffect(() => setFormulaDraft(null), [selection.focus.row, selection.focus.col, index])

  // Один вычислитель на весь проход поиска: внутри он запоминает посчитанное,
  // а создание нового на каждую ячейку сводило бы эту память на нет.
  //
  // Стоит выше возврата «книга пуста» намеренно. Хук после условного возврата
  // роняет React целиком («Rendered fewer hooks than expected»), а случай этот
  // достижим: двое удаляют по листу, у каждого проверка «последний лист не
  // удаляем» проходит, а после слияния листов не остаётся вовсе.
  const evaluator = useMemo(
    () => new Evaluator((row, col) => (sheet ? readRaw(sheet, row, col) : null)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sheet, version],
  )

  // Книга без листов чинится на месте: показывать тупик там, где достаточно
  // создать лист, незачем.
  useEffect(() => {
    if (sheets.length === 0) ensureBook(doc)
  }, [doc, sheets.length])

  if (!sheet) {
    return <p className="p-12 text-center text-ink-muted" role="status">Восстановление книги…</p>
  }

  const changeSelection = (next: Selection) => {
    setSelection(next)
    if (!editable) return

    // Лист растёт под пользователем: упереться в нижнюю границу нельзя.
    if (next.focus.row >= rowCount(sheet) - 1 && rowCount(sheet) < MAX_ROWS) {
      growRows(doc, sheet, 100)
    }
    if (next.focus.col >= colCount(sheet) - 1 && colCount(sheet) < MAX_COLS) {
      growCols(doc, sheet, 5)
    }
  }

  const styleSelection = (patch: CellStyle) => {
    if (!editable) return
    applyStyle(doc, sheet, cellsOfSelection(selection), patch)
  }

  const commitFormula = () => {
    if (formulaDraft === null || !editable) return
    writeCell(doc, sheet, selection.focus.row, selection.focus.col, formulaDraft)
    setFormulaDraft(null)
  }

  const handlePaste = (row: number, col: number, grid: string[][]) => {
    if (!editable) return

    doc.transact(() => {
      grid.forEach((line, rowOffset) => {
        line.forEach((value, colOffset) => {
          const target = { row: row + rowOffset, col: col + colOffset }
          if (target.row >= MAX_ROWS || target.col >= MAX_COLS) return
          writeCell(doc, sheet, target.row, target.col, value)
        })
      })
    })

    const last = {
      row: Math.min(row + grid.length - 1, MAX_ROWS - 1),
      col: Math.min(col + Math.max(...grid.map((line) => line.length)) - 1, MAX_COLS - 1),
    }
    setSelection({ anchor: { row, col }, focus: last })
  }

  const handleShortcuts = (event: React.KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) return

    const key = event.key.toLowerCase()
    if (key === 'b') {
      event.preventDefault()
      styleSelection({ bold: focusStyle.bold ? undefined : true })
    } else if (key === 'i') {
      event.preventDefault()
      styleSelection({ italic: focusStyle.italic ? undefined : true })
    } else if (key === 'u') {
      event.preventDefault()
      styleSelection({ underline: focusStyle.underline ? undefined : true })
    } else if (key === 'z') {
      event.preventDefault()
      if (event.shiftKey) undoManager.redo()
      else undoManager.undo()
    } else if (key === 'y') {
      event.preventDefault()
      undoManager.redo()
    } else if (key === 'f') {
      // Ctrl+F — поиск по листу, а не по странице: в таблице на пять тысяч
      // строк браузер ищет только по отрисованным ячейкам, то есть по экрану.
      event.preventDefault()
      setFinding(true)
    }
  }

  /**
   * Показанное значение ячейки — по нему поиск находит результат формулы.
   *
   * Вычислитель заводится на каждый лист отдельно и запоминается: поиск по
   * книге иначе пересчитывал бы чужой лист на каждую клетку.
   */
  const displayForSheet = (sheetIndex: number) => {
    if (sheetIndex === index) return displayAt

    const target = sheetAt(doc, sheetIndex)
    if (!target) return () => ''

    const other = new Evaluator((row, col) => readRaw(target, row, col))
    return (row: number, col: number) =>
      formatValue(other.valueAt(row, col), readStyle(target, row, col).format)
  }

  const displayAt = (row: number, col: number) =>
    formatValue(evaluator.valueAt(row, col), readStyle(sheet, row, col).format)

  const rect = bounds(selection)

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={handleShortcuts}>
      <SpreadsheetToolbar
        editable={editable}
        style={focusStyle}
        onStyle={styleSelection}
        onUndo={() => undoManager.undo()}
        onRedo={() => undoManager.redo()}
        onInsertRow={() => editable && insertRow(doc, sheet, rect.top)}
        onDeleteRow={() => editable && deleteRow(doc, sheet, rect.top)}
        onInsertCol={() => editable && insertCol(doc, sheet, rect.left)}
        onDeleteCol={() => editable && deleteCol(doc, sheet, rect.left)}
        onFill={(value) => {
          if (!editable) return
          doc.transact(() => {
            cellsOfSelection(selection).forEach((cell) =>
              writeCell(doc, sheet, cell.row, cell.col, value),
            )
          })
        }}
        onFind={() => setFinding(true)}
        onAddRow={() => setAdding(true)}
        headerFrozen={frozen(sheet).rows > 0}
        // Закрепляется одна строка — шапка. Больше одной в журнале не бывает,
        // а выбор «сколько строк» ради этого не стоит лишнего окна.
        onToggleFreeze={() =>
          editable && setFrozen(doc, sheet, { rows: frozen(sheet).rows > 0 ? 0 : 1 })
        }
        onCharts={() => setCharting(true)}
      />

      {/* Строка адреса и формул */}
      <div className="flex items-center gap-2 border-b border-hairline bg-surface px-3 py-1.5">
        <span
          className="w-24 shrink-0 rounded border border-hairline px-2 py-1 text-center text-sm font-medium"
          aria-label="Выделенный диапазон"
        >
          {label(selection, cellRef)}
        </span>
        <span className="shrink-0 text-ink-muted" aria-hidden="true">
          fx
        </span>
        <input
          value={formulaDraft ?? focusRaw ?? ''}
          disabled={!editable}
          aria-label="Строка формул"
          placeholder="Значение или формула, например =СУММ(A1:A10)"
          onChange={(event) => setFormulaDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commitFormula()
            } else if (event.key === 'Escape') {
              setFormulaDraft(null)
            }
          }}
          onBlur={commitFormula}
          className="min-w-0 flex-1 rounded border border-transparent px-2 py-1 text-sm outline-none focus:border-accent disabled:opacity-60"
        />
      </div>

      {charting && (
        <ChartsDialog
          doc={doc}
          sheet={sheet}
          version={version}
          editable={editable}
          display={displayForSheet(index)}
          selection={rect}
          onClose={() => setCharting(false)}
        />
      )}

      {adding && (
        <AddRowDialog
          doc={doc}
          sheet={sheet}
          version={version}
          cols={colCount(sheet)}
          // Выделение переходит на новую запись: видно, что она добавилась,
          // и сетка сама прокручивается к ней.
          onAdded={(row) => setSelection(cellAt(row, 0))}
          onClose={() => setAdding(false)}
        />
      )}

      {finding && (
        <SheetFind
          doc={doc}
          sheet={sheet}
          sheetIndex={index}
          sheets={sheets}
          version={version}
          editable={editable}
          displayFor={displayForSheet}
          onGo={(hit) => {
            // Совпадение может лежать на другом листе: сначала переключаемся,
            // иначе выделение встало бы на ту же клетку текущего листа.
            if (hit.sheet !== undefined && hit.sheet !== index) setActive(hit.sheet)
            setSelection(cellAt(hit.row, hit.col))
          }}
          onMatchesChange={setMatches}
          onClose={() => setFinding(false)}
        />
      )}

      <Grid
        doc={doc}
        sheet={sheet}
        version={version}
        editable={editable}
        selection={selection}
        onSelectionChange={changeSelection}
        onCommit={(row, col, raw) => editable && writeCell(doc, sheet, row, col, raw)}
        onClear={(list: Cell[]) => editable && clearCells(doc, sheet, list)}
        onPaste={handlePaste}
        editRequest={editRequest}
        matches={matches}
      />

      <SheetTabs
        sheets={sheets}
        active={index}
        editable={editable}
        onSelect={(next) => {
          setActive(next)
          setSelection(cellAt(0, 0))
        }}
        onAdd={() => setActive(addSheet(doc))}
        onRename={(position, name) => renameSheet(doc, position, name)}
        onRemove={(position) => {
          removeSheet(doc, position)
          setActive(Math.max(position - 1, 0))
        }}
      />

      {/* Кнопка нужна тем, кто ходит по таблице с клавиатуры: правка ячейки
          иначе начиналась бы только вводом символа. */}
      <button type="button" className="sr-only" onClick={() => setEditRequest((n) => n + 1)}>
        Изменить выделенную ячейку
      </button>
    </div>
  )
}
