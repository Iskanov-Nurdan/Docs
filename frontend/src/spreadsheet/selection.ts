/** Прямоугольное выделение: якорь ставится нажатием, фокус ведёт протяжка. */

export type Cell = { row: number; col: number }

export type Selection = {
  anchor: Cell
  focus: Cell
}

export type Rect = { top: number; left: number; bottom: number; right: number }

export const cellAt = (row: number, col: number): Selection => ({
  anchor: { row, col },
  focus: { row, col },
})

export function bounds(selection: Selection): Rect {
  return {
    top: Math.min(selection.anchor.row, selection.focus.row),
    bottom: Math.max(selection.anchor.row, selection.focus.row),
    left: Math.min(selection.anchor.col, selection.focus.col),
    right: Math.max(selection.anchor.col, selection.focus.col),
  }
}

export function contains(selection: Selection, row: number, col: number): boolean {
  const rect = bounds(selection)
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right
}

export function isSingle(selection: Selection): boolean {
  return selection.anchor.row === selection.focus.row
    && selection.anchor.col === selection.focus.col
}

export function cells(selection: Selection): Cell[] {
  const rect = bounds(selection)
  const list: Cell[] = []
  for (let row = rect.top; row <= rect.bottom; row += 1) {
    for (let col = rect.left; col <= rect.right; col += 1) {
      list.push({ row, col })
    }
  }
  return list
}

/** Подпись диапазона для строки адреса: «B12» или «A1:C4». */
export function label(selection: Selection, ref: (row: number, col: number) => string): string {
  const rect = bounds(selection)
  const from = ref(rect.top, rect.left)
  if (rect.top === rect.bottom && rect.left === rect.right) return from
  return `${from}:${ref(rect.bottom, rect.right)}`
}
