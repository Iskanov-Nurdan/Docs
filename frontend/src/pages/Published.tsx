/**
 * Опубликованный документ: /public/document/{public_id}.
 *
 * Единственная страница, доступная без входа в систему. Содержимое
 * показывается тем же редактором в режиме чтения, а не отдельной разметкой:
 * иначе таблицы, списки и выравнивание выглядели бы иначе, чем в документе.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '@/api'
import { SheetSnapshotView, isSheetContent } from '@/spreadsheet/SheetSnapshotView'
import { formatDateTime } from '@/utils/date'

type Published = { title: string; content: unknown; published_at: string }

export function PublishedPage() {
  const { publicId } = useParams<{ publicId: string }>()
  const [document, setDocument] = useState<Published | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!publicId) return
    let cancelled = false

    api
      .getPublished(publicId)
      .then((data) => {
        if (!cancelled) setDocument(data)
      })
      .catch(() => {
        if (!cancelled) setError('Страница не найдена или снята с публикации')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [publicId])



  if (loading) {
    return <p className="p-12 text-center text-ink-muted">Загрузка…</p>
  }

  if (error || !document) {
    return (
      <div className="p-12 text-center">
        <p className="text-ink">{error || 'Страница недоступна'}</p>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="border-b border-hairline bg-surface px-4 py-3">
        <div className="mx-auto max-w-3xl">
          <h1 className="text-xl font-semibold text-ink">{document.title}</h1>
          <p className="text-xs text-ink-muted">
            Опубликовано {formatDateTime(document.published_at)}
          </p>
        </div>
      </header>

      <main className="px-4 py-8">
        <div className="mx-auto max-w-5xl rounded-lg bg-surface p-4 shadow-sm ring-1 ring-hairline">
          {isSheetContent(document.content) ? (
            <SheetSnapshotView content={document.content} />
          ) : (
            <p className="py-8 text-center text-sm text-ink-muted">Содержимое недоступно</p>
          )}
        </div>
      </main>
    </div>
  )
}
