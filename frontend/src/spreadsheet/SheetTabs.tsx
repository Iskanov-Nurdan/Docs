/** Ярлычки листов внизу книги. */
import { useState } from 'react'
import { CloseIcon, PlusIcon } from '@/components/icons'
import type { SheetInfo } from './model'

type Props = {
  sheets: SheetInfo[]
  active: number
  editable: boolean
  onSelect: (index: number) => void
  onAdd: () => void
  onRename: (index: number, name: string) => void
  onRemove: (index: number) => void
}

export function SheetTabs({ sheets, active, editable, onSelect, onAdd, onRename, onRemove }: Props) {
  const [renaming, setRenaming] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const startRenaming = (index: number) => {
    if (!editable) return
    setRenaming(index)
    setDraft(sheets[index].name)
  }

  const commit = () => {
    if (renaming === null) return
    onRename(renaming, draft)
    setRenaming(null)
  }

  return (
    <div className="flex items-center gap-1 border-t border-hairline bg-surface px-2 py-1">
      {editable && (
        <button
          type="button"
          onClick={onAdd}
          title="Добавить лист"
          aria-label="Добавить лист"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-accent"
        >
          <PlusIcon size={16} />
        </button>
      )}

      <div role="tablist" aria-label="Листы" className="no-scrollbar flex min-w-0 flex-1 gap-1 overflow-x-auto">
        {sheets.map((sheet, index) =>
          renaming === index ? (
            <input
              key={sheet.id}
              autoFocus
              value={draft}
              aria-label="Название листа"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
                if (event.key === 'Escape') setRenaming(null)
              }}
              className="h-7 w-28 rounded border border-accent bg-surface px-2 text-sm outline-none"
            />
          ) : (
            <button
              key={sheet.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => onSelect(index)}
              onDoubleClick={() => startRenaming(index)}
              title={editable ? 'Двойной щелчок — переименовать' : sheet.name}
              className={[
                'h-7 shrink-0 rounded-full px-3.5 text-sm transition-colors',
                index === active
                  ? 'bg-surface-muted font-medium text-ink ring-1 ring-hairline'
                  : 'text-ink-muted hover:bg-surface-muted',
              ].join(' ')}
            >
              {sheet.name}
            </button>
          ),
        )}
      </div>

      {editable && sheets.length > 1 && (
        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Удалить лист «${sheets[active].name}»? Данные листа пропадут.`)) {
              onRemove(active)
            }
          }}
          title="Удалить текущий лист"
          aria-label="Удалить текущий лист"
          className="flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-red-50 hover:text-red-600"
        >
          <CloseIcon size={15} />
        </button>
      )}
    </div>
  )
}
