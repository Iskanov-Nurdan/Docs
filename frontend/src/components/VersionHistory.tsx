/**
 * История версий: список снимков, просмотр и восстановление.
 *
 * Восстановление не удаляет ничего: сервер создаёт новую версию с содержимым
 * выбранной, и цепочка остаётся полной. Поэтому «откат» здесь — это движение
 * вперёд, а не назад по списку.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/api'
import { formatDateTime } from '@/utils/date'
import { SheetSnapshotView, isSheetContent } from '@/spreadsheet/SheetSnapshotView'
import type { Role, Version } from '@/types'

type Props = {
  documentId: string
  role: Role | null
  onClose: () => void
  /** Восстановление меняет документ — страница должна перечитать его. */
  onRestored: () => void
}

export function VersionHistory({ documentId, role, onClose, onRestored }: Props) {
  const [versions, setVersions] = useState<Version[]>([])
  const [selected, setSelected] = useState<Version | null>(null)
  const [content, setContent] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const [loadingContent, setLoadingContent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const canRestore = role === 'owner' || role === 'editor'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setError('')
      const list = await api.listVersions(documentId)
      setVersions(list)
      setSelected((current) => current ?? list[0] ?? null)
    } catch {
      setError('Не удалось загрузить историю')
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    load()
  }, [load])

  // История открывается поверх всего окна: без Escape из неё нельзя выйти
  // с клавиатуры.
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  useEffect(() => {
    if (!selected) return
    // Ответ по отменённому выбору не должен подменить уже открытую версию.
    let cancelled = false
    setLoadingContent(true)

    api
      .getVersion(documentId, selected.id)
      .then((version) => {
        if (!cancelled) setContent(version.content)
      })
      .catch(() => {
        if (!cancelled) setError('Не удалось открыть версию')
      })
      .finally(() => {
        if (!cancelled) setLoadingContent(false)
      })

    return () => {
      cancelled = true
    }
  }, [documentId, selected])

  const saveCurrent = async () => {
    setBusy(true)
    try {
      const label = window.prompt('Название версии', '')
      if (label === null) return
      await api.saveVersion(documentId, label)
      await load()
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'Не удалось сохранить версию')
    } finally {
      setBusy(false)
    }
  }

  const restore = async () => {
    if (!selected) return
    if (
      !window.confirm(
        `Восстановить версию ${selected.version_number}? Текущая останется в истории.`,
      )
    )
      return

    setBusy(true)
    try {
      await api.restoreVersion(documentId, selected.id)
      onRestored()
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'Не удалось восстановить версию')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-surface">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <h2 className="flex-1 text-base font-semibold text-ink">История версий</h2>

        {canRestore && (
          <button
            type="button"
            onClick={saveCurrent}
            disabled={busy}
            className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted disabled:opacity-40"
          >
            Сохранить текущую
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          Закрыть
        </button>
      </header>

      {error && (
        <p className="border-b border-hairline bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        <div className="min-h-0 flex-1 overflow-auto bg-surface-muted p-4 md:p-8">
          {loadingContent && <p className="text-center text-sm text-ink-muted">Загрузка версии…</p>}
          {!loadingContent && content !== null && <VersionPreview content={content} />}
          {!loadingContent && content === null && !loading && (
            <p className="text-center text-sm text-ink-muted">Выберите версию слева</p>
          )}
        </div>

        <aside
          aria-label="Список версий"
          className="flex max-h-64 w-full shrink-0 flex-col border-b border-hairline md:max-h-none md:w-72 md:border-b-0 md:border-l"
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && <p className="p-4 text-sm text-ink-muted">Загрузка…</p>}

            {!loading && versions.length === 0 && (
              <p className="p-4 text-sm text-ink-muted">
                Снимков пока нет. Они создаются по ходу работы и по кнопке выше.
              </p>
            )}

            <ul className="divide-y divide-hairline">
              {versions.map((version) => (
                <li key={version.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(version)}
                    aria-current={selected?.id === version.id ? 'true' : undefined}
                    className={[
                      'w-full px-4 py-3 text-left transition-colors hover:bg-surface-muted',
                      selected?.id === version.id ? 'bg-surface-muted' : '',
                    ].join(' ')}
                  >
                    <p className="text-sm font-medium text-ink">
                      {version.label || `Версия ${version.version_number}`}
                    </p>
                    <p className="text-xs text-ink-muted">{formatDateTime(version.created_at)}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {version.user?.display_name ?? 'Система'}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {canRestore && selected && (
            <div className="border-t border-hairline p-3">
              <button
                type="button"
                onClick={restore}
                disabled={busy}
                className="w-full rounded bg-accent px-3 py-2 text-sm font-medium text-white disabled:opacity-40"
              >
                Восстановить эту версию
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

/** Старая версия — только для чтения: править её нельзя, можно восстановить. */
function VersionPreview({ content }: { content: unknown }) {
  // Снимок книги и дерево узлов рисуются по-разному, а приходят одним полем.
  if (isSheetContent(content)) {
    return (
      <div className="mx-auto max-w-4xl rounded-lg bg-surface p-4 shadow-sm ring-1 ring-hairline">
        <SheetSnapshotView content={content} />
      </div>
    )
  }

  return (
    <p className="py-8 text-center text-sm text-ink-muted">
      Версия сохранена прежним форматом и не открывается
    </p>
  )
}
