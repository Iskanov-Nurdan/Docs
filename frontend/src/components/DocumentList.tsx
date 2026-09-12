/** Список документов сеткой или строками — общий для всех разделов. */
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ConfirmDialog } from './ConfirmDialog'
import { InputDialog } from './InputDialog'
import { Menu } from './Menu'
import { MoveDialog } from './MoveDialog'
import { api } from '@/api'
import { useFolders } from '@/store/folders'
import { CopyIcon, MoreIcon, RestoreIcon, SheetIcon, StarIcon, TrashIcon } from './icons'
import { formatDateTime } from '@/utils/date'
import type { DocumentSummary } from '@/types'

export type ListView = 'grid' | 'list'

/**
 * Подсветка найденного куска.
 *
 * Совпадение ищется без учёта регистра, но показывается ровно так, как
 * написано в документе: подменять «СЧ» на «сч» из строки поиска нельзя.
 */
function highlight(text: string, query: string): React.ReactNode {
  const needle = query.trim()
  if (!needle) return text

  const parts: React.ReactNode[] = []
  const haystack = text.toLowerCase()
  const lower = needle.toLowerCase()
  let from = 0

  for (;;) {
    const at = haystack.indexOf(lower, from)
    if (at === -1) break
    if (at > from) parts.push(text.slice(from, at))
    parts.push(
      <mark key={at} className="rounded bg-amber-200 px-0.5 text-ink dark:bg-amber-500/40">
        {text.slice(at, at + needle.length)}
      </mark>,
    )
    from = at + needle.length
  }

  if (parts.length === 0) return text
  parts.push(text.slice(from))
  return parts
}

type Props = {
  documents: DocumentSummary[]
  view: ListView
  /** Что искали: по нему подсвечивается совпадение в названии и фрагменте. */
  query?: string
  /** В корзине набор действий другой: восстановить или удалить навсегда. */
  trash?: boolean
  /** Документ изменился — страница обновляет свою копию списка. */
  onUpdate: (document: DocumentSummary) => void
  /** Документ покинул текущий раздел. */
  onRemove: (id: string) => void
}

type Dialog =
  | { kind: 'rename' | 'move' | 'trash' | 'purge'; document: DocumentSummary }
  | null

export function DocumentList({
  documents,
  view,
  query = '',
  trash = false,
  onUpdate,
  onRemove,
}: Props) {
  const navigate = useNavigate()
  const { load: reloadFolders } = useFolders()
  const [dialog, setDialog] = useState<Dialog>(null)

  const toggleStar = async (document: DocumentSummary) => {
    const { is_starred } = await api.starDocument(document.id)
    onUpdate({ ...document, is_starred })
  }

  const copy = async (document: DocumentSummary) => {
    const created = await api.copyDocument(document.id)
    navigate(`/documents/${created.id}`)
  }

  const actions = (document: DocumentSummary) =>
    trash
      ? [
          {
            label: 'Восстановить',
            icon: <RestoreIcon size={16} />,
            onSelect: async () => {
              await api.restoreDocument(document.id)
              onRemove(document.id)
            },
          },
          {
            label: 'Удалить навсегда',
            icon: <TrashIcon size={16} />,
            danger: true,
            onSelect: () => setDialog({ kind: 'purge', document }),
          },
        ]
      : [
          { label: 'Открыть', onSelect: () => navigate(`/documents/${document.id}`) },
          {
            label: 'Переименовать',
            disabled: document.my_role !== 'owner' && document.my_role !== 'editor',
            onSelect: () => setDialog({ kind: 'rename', document }),
          },
          {
            label: 'Переместить',
            disabled: document.my_role !== 'owner',
            onSelect: () => setDialog({ kind: 'move', document }),
          },
          {
            label: document.is_starred ? 'Убрать из избранного' : 'В избранное',
            icon: <StarIcon size={16} filled={document.is_starred} />,
            onSelect: () => toggleStar(document),
          },
          { label: 'Создать копию', icon: <CopyIcon size={16} />, onSelect: () => copy(document) },
          {
            label: 'В корзину',
            icon: <TrashIcon size={16} />,
            danger: true,
            disabled: document.my_role !== 'owner',
            onSelect: () => setDialog({ kind: 'trash', document }),
          },
        ]

  const meta = (document: DocumentSummary) =>
    trash
      ? `Удалён ${formatDateTime(document.deleted_at)}`
      : `${document.owner.display_name} · ${formatDateTime(document.last_edited_at)}`

  const star = (document: DocumentSummary) => (
    <button
      type="button"
      onClick={() => toggleStar(document)}
      aria-label={document.is_starred ? 'Убрать из избранного' : 'В избранное'}
      aria-pressed={document.is_starred}
      className={[
        'rounded-full p-1.5 hover:bg-surface-muted',
        document.is_starred ? 'text-amber-500' : 'text-ink-muted',
      ].join(' ')}
    >
      <StarIcon size={16} filled={document.is_starred} />
    </button>
  )

  return (
    <>
      {view === 'grid' ? (
        <ul className="animate-rise grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {documents.map((document) => (
            <li
              key={document.id}
              className="flex flex-col rounded-lg border border-hairline bg-surface p-3 transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
            >
              <Link to={`/documents/${document.id}`} className="block min-w-0 flex-1">
                <span className="mb-3 block h-32 overflow-hidden rounded border border-hairline bg-white p-2 text-[7px] leading-tight text-gray-500">
                  {document.preview || 'Пустая таблица'}
                </span>
                <span className="flex items-center gap-1.5 truncate font-medium text-ink">
                  <SheetIcon size={16} className="text-ink-muted" />
                  <span className="truncate">{highlight(document.title, query)}</span>
                </span>
                <span className="block truncate text-xs text-ink-muted">{meta(document)}</span>
                {document.snippet && (
                  <span className="mt-1 block line-clamp-2 text-xs text-ink-muted">
                    {highlight(document.snippet, query)}
                  </span>
                )}
              </Link>

              <div className="mt-1 flex shrink-0 items-center justify-end gap-1">
                {!trash && star(document)}
                <Menu
                  label={`Действия с документом «${document.title}»`}
                  trigger={<MoreIcon size={16} />}
                  items={actions(document)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        /* Списком документы читают как таблицу: одинаковые колонки сверху вниз
           сравнивать глазами проще, чем строки со слипшимися подписями. */
        <div className="animate-rise overflow-x-auto rounded-lg border border-hairline bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  Название
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">
                  Владелец
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  {trash ? 'Удалён' : 'Изменён'}
                </th>
                <th scope="col" className="w-24 px-2 py-2">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-hairline">
              {documents.map((document) => (
                <tr key={document.id} className="hover:bg-accent/5">
                  <td className="max-w-0 px-4 py-2">
                    <Link
                      to={`/documents/${document.id}`}
                      className="flex items-center gap-1.5 truncate font-medium text-ink hover:text-accent"
                    >
                      <SheetIcon size={16} className="text-ink-muted" />
                      <span className="truncate">{highlight(document.title, query)}</span>
                    </Link>
                    {document.snippet && (
                      <span className="block truncate text-xs text-ink-muted">
                        {highlight(document.snippet, query)}
                      </span>
                    )}
                    <span className="block truncate text-xs text-ink-muted sm:hidden">
                      {meta(document)}
                    </span>
                  </td>
                  <td className="hidden max-w-0 truncate px-4 py-2 text-ink-muted sm:table-cell">
                    {document.owner.display_name}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2 text-ink-muted md:table-cell">
                    {formatDateTime(trash ? document.deleted_at : document.last_edited_at)}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {!trash && star(document)}
                      <Menu
                        label={`Действия с документом «${document.title}»`}
                        trigger={<MoreIcon size={16} />}
                        items={actions(document)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === 'rename' && (
        <InputDialog
          title="Переименовать документ"
          label="Название"
          initialValue={dialog.document.title}
          onSubmit={async (value) => {
            const updated = await api.updateDocument(dialog.document.id, { title: value })
            onUpdate({ ...dialog.document, title: updated.title })
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'move' && (
        <MoveDialog
          title={`Переместить «${dialog.document.title}»`}
          currentFolderId={dialog.document.folder}
          onSubmit={async (folderId) => {
            await api.updateDocument(dialog.document.id, { folder_id: folderId })
            onUpdate({ ...dialog.document, folder: folderId })
            // Счётчики документов в дереве папок изменились.
            await reloadFolders(true)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'trash' && (
        <ConfirmDialog
          title="В корзину"
          message={`Документ «${dialog.document.title}» переедет в корзину. Оттуда его можно восстановить.`}
          confirmLabel="Удалить"
          danger
          onConfirm={async () => {
            await api.deleteDocument(dialog.document.id)
            onRemove(dialog.document.id)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'purge' && (
        <ConfirmDialog
          title="Удалить навсегда"
          message={`«${dialog.document.title}» будет удалён безвозвратно вместе с историей версий и обсуждением.`}
          confirmLabel="Удалить навсегда"
          danger
          onConfirm={async () => {
            await api.deleteDocument(dialog.document.id, true)
            onRemove(dialog.document.id)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}
