/** Перемещение документа: выбор папки из дерева пользователя. */
import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { FolderIcon } from './icons'
import { buildFolderTree, useFolders, type FolderNode } from '@/store/folders'

type Props = {
  title: string
  currentFolderId: string | null
  onSubmit: (folderId: string | null) => Promise<void>
  onClose: () => void
}

export function MoveDialog({ title, currentFolderId, onSubmit, onClose }: Props) {
  const { folders, loading, load } = useFolders()
  const [selected, setSelected] = useState<string | null>(currentFolderId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load()
  }, [load])

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await onSubmit(selected)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось переместить')
    } finally {
      setBusy(false)
    }
  }

  const option = (node: FolderNode, depth: number): React.ReactNode => (
    <div key={node.id}>
      <label
        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <input
          type="radio"
          name="folder"
          checked={selected === node.id}
          onChange={() => setSelected(node.id)}
        />
        <span className="flex min-w-0 items-center gap-1.5 truncate text-ink">
          <FolderIcon size={15} className="text-ink-muted" />
          {node.name}
        </span>
      </label>
      {node.children.map((child) => option(child, depth + 1))}
    </div>
  )

  return (
    <Modal
      title={title}
      onClose={onClose}
      width="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Перемещение…' : 'Переместить'}
          </button>
        </div>
      }
    >
      {loading && <p className="py-6 text-center text-sm text-ink-muted">Загрузка папок…</p>}

      {!loading && (
        <div className="max-h-72 overflow-y-auto">
          <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-surface-muted">
            <input
              type="radio"
              name="folder"
              checked={selected === null}
              onChange={() => setSelected(null)}
            />
            <span className="text-ink">Мои документы (без папки)</span>
          </label>
          {buildFolderTree(folders).map((node) => option(node, 1))}
        </div>
      )}

      {!loading && folders.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">
          Папок пока нет — создайте их в боковой панели.
        </p>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </Modal>
  )
}
