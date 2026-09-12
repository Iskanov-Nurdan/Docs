/**
 * Показ сохранённой книги без редактора.
 *
 * Нужен там, где правка невозможна: старая версия в истории и опубликованная
 * страница. Ячейки берутся из снимка как есть — формулы в нём уже посчитаны,
 * поэтому вычислитель здесь не нужен и книга Yjs не создаётся.
 */
import { useMemo, useState } from 'react'
import { colLabel, parseRef } from './formula'
import { statusTone } from './statuses'
import type { SheetContent, SheetSnapshot } from '@/types'

type Grid = { rows: string[][]; width: number }

/** Разреженные ячейки — в прямоугольник по крайней заполненной. */
function toGrid(sheet: SheetSnapshot): Grid {
  const parsed: { row: number; col: number; text: string }[] = []

  Object.entries(sheet.cells ?? {}).forEach(([reference, cell]) => {
    const position = parseRef(reference)
    if (!position) return
    const text = cell?.display ?? cell?.value ?? ''
    if (text === '') return
    parsed.push({ ...position, text })
  })

  if (parsed.length === 0) return { rows: [], width: 0 }

  const height = Math.max(...parsed.map((item) => item.row)) + 1
  const width = Math.max(...parsed.map((item) => item.col)) + 1

  const rows = Array.from({ length: height }, () => Array.from({ length: width }, () => ''))
  parsed.forEach(({ row, col, text }) => {
    rows[row][col] = text
  })

  return { rows, width }
}

export function SheetSnapshotView({ content }: { content: SheetContent }) {
  const sheets = content.sheets ?? []
  const [active, setActive] = useState(0)
  const sheet = sheets[active]
  const grid = useMemo(() => (sheet ? toGrid(sheet) : { rows: [], width: 0 }), [sheet])

  if (!sheet) {
    return <p className="py-8 text-center text-sm text-ink-muted">В книге нет листов</p>
  }

  return (
    <div>
      {sheets.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1" role="tablist" aria-label="Листы книги">
          {sheets.map((item, index) => (
            <button
              key={item.id || index}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={[
                'rounded px-3 py-1 text-sm',
                index === active
                  ? 'bg-accent text-white'
                  : 'border border-hairline bg-surface hover:bg-surface-muted',
              ].join(' ')}
            >
              {item.name || `Лист ${index + 1}`}
            </button>
          ))}
        </div>
      )}

      {grid.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">Лист пуст</p>
      ) : (
        <div className="overflow-x-auto rounded border border-hairline">
          <table className="border-collapse text-sm">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 w-10 border-b border-r border-hairline bg-surface-muted" />
                {Array.from({ length: grid.width }, (_, column) => (
                  <th
                    key={column}
                    scope="col"
                    className="min-w-24 border-b border-r border-hairline bg-surface-muted px-2 py-1 text-xs font-medium text-ink-muted"
                  >
                    {colLabel(column)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows.map((row, index) => (
                <tr key={index}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 border-b border-r border-hairline bg-surface-muted px-2 py-1 text-xs font-normal text-ink-muted"
                  >
                    {index + 1}
                  </th>
                  {row.map((cell, column) => {
                    // Цвет статуса такой же, как в редакторе: читатель
                    // опубликованной таблицы должен видеть просрочку сразу.
                    const tone = statusTone(cell)
                    return (
                      <td
                        key={column}
                        style={tone ? { background: tone.background, color: tone.color } : undefined}
                        className="whitespace-nowrap border-b border-r border-hairline bg-surface px-2 py-1 text-ink"
                      >
                        {cell}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/** Содержимое документа — книга, а не дерево узлов ProseMirror. */
export function isSheetContent(content: unknown): content is SheetContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    (content as { kind?: string }).kind === 'sheet' &&
    Array.isArray((content as SheetContent).sheets)
  )
}
