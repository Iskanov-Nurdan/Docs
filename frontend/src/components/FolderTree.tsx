/** Дерево папок в боковой панели: переход, переименование, удаление. */
import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ConfirmDialog } from './ConfirmDialog'
import { InputDialog } from './InputDialog'
import { Menu } from './Menu'
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, MoreIcon, PlusIcon, TrashIcon } from './icons'
import { buildFolderTree, useFolders, type FolderNode } from '@/store/folders'

type Dialog =
  | { kind: 'rename'; folder: FolderNode }
  | { kind: 'child'; folder: FolderNode }
  | { kind: 'delete'; folder: FolderNode }
  | null

export function FolderTree({ onNavigate }: { onNavigate?: () => void }) {
  const { folders, loading, error, load, create, rename, remove } = useFolders()
  const [dialog, setDialog] = useState<Dialog>(null)
  // Свёрнутые ветки: по умолчанию дерево раскрыто — папок обычно немного.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const row = (node: FolderNode, depth: number): React.ReactNode => {
    const hasChildren = node.children.length > 0
    const isCollapsed = collapsed.has(node.id)

    return (
      <li key={node.id}>
        <div
          className="group flex items-center gap-0.5 rounded hover:bg-surface-muted"
          style={{ paddingLeft: `${depth * 12}px` }}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggle(node.id)}
              aria-label={isCollapsed ? `Раскрыть «${node.name}»` : `Свернуть «${node.name}»`}
              aria-expanded={!isCollapsed}
              className="flex w-5 shrink-0 items-center justify-center text-ink-muted"
            >
              {isCollapsed ? <ChevronRightIcon size={14} /> : <ChevronDownIcon size={14} />}
            </button>
          ) : (
            <span className="w-5 shrink-0" aria-hidden="true" />
          )}

          <NavLink
            to={`/folders/${node.id}`}
            onClick={onNavigate}
            className={({ isActive }) =>
              [
                'min-w-0 flex-1 truncate rounded px-1 py-1.5 text-sm',
                isActive ? 'font-medium text-accent' : 'text-ink',
              ].join(' ')
            }
          >
            <FolderIcon size={15} className="mr-1.5 inline-block align-[-2px] text-ink-muted" />
            {node.name}
            {node.documents_count > 0 && (
              <span className="ml-1 text-xs text-ink-muted">{node.documents_count}</span>
            )}
          </NavLink>

          <Menu
            label={`Действия с папкой «${node.name}»`}
            trigger={<MoreIcon size={16} />}
            className="rounded px-1.5 py-1 text-ink-muted opacity-0 focus:opacity-100 group-hover:opacity-100"
            items={[
              { label: 'Переименовать', onSelect: () => setDialog({ kind: 'rename', folder: node }) },
              {
                label: 'Вложенная папка',
                icon: <PlusIcon size={16} />,
                onSelect: () => setDialog({ kind: 'child', folder: node }),
              },
              {
                label: 'Удалить папку',
                icon: <TrashIcon size={16} />,
                danger: true,
                onSelect: () => setDialog({ kind: 'delete', folder: node }),
              },
            ]}
          />
        </div>

        {hasChildren && !isCollapsed && (
          <ul>{node.children.map((child) => row(child, depth + 1))}</ul>
        )}
      </li>
    )
  }

  const tree = buildFolderTree(folders)

  return (
    <>
      {loading && folders.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-ink-muted">Загрузка…</p>
      )}

      {error && (
        <div className="px-2 py-1.5">
          <p className="text-sm text-red-600">{error}</p>
          <button
            type="button"
            onClick={() => load(true)}
            className="mt-1 text-xs text-accent hover:underline"
          >
            Повторить
          </button>
        </div>
      )}

      {!loading && !error && tree.length === 0 && (
        <p className="px-2 py-1.5 text-sm text-ink-muted">Папок пока нет</p>
      )}

      {tree.length > 0 && <ul>{tree.map((node) => row(node, 0))}</ul>}

      {dialog?.kind === 'rename' && (
        <InputDialog
          title="Переименовать папку"
          label="Название"
          initialValue={dialog.folder.name}
          onSubmit={(value) => rename(dialog.folder.id, value)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'child' && (
        <InputDialog
          title={`Папка внутри «${dialog.folder.name}»`}
          label="Название"
          submitLabel="Создать"
          onSubmit={async (value) => {
            await create(value, dialog.folder.id)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          title="Удалить папку"
          message={`Папка «${dialog.folder.name}» будет удалена. Документы из неё переедут в «Мои документы» и не будут потеряны.`}
          confirmLabel="Удалить"
          danger
          onConfirm={() => remove(dialog.folder.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}
