/** Список документов: поиск, сортировка, вид сеткой и списком. */
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/api'
import { useAuth } from '@/store/auth'
import type { DocumentSummary } from '@/types'

type View = 'grid' | 'list'
type Scope = 'active' | 'starred' | 'trash'

const SORTS = [
  { value: '-last_edited_at', label: 'Сначала изменённые' },
  { value: '-created_at', label: 'Сначала новые' },
  { value: 'title', label: 'По названию (А–Я)' },
  { value: '-title', label: 'По названию (Я–А)' },
]

const SCOPES: { value: Scope; label: string }[] = [
  { value: 'active', label: 'Мои документы' },
  { value: 'starred', label: 'Избранное' },
  { value: 'trash', label: 'Корзина' },
]

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  )
}

export function DocsPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const [params, setParams] = useSearchParams()

  const scope = (params.get('scope') as Scope) ?? 'active'
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>(
    () => (localStorage.getItem('docs.view') as View) ?? 'grid',
  )
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [ordering, setOrdering] = useState('-last_edited_at')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.listDocuments({
        scope: query ? 'search' : scope,
        q: query || undefined,
        ordering,
        page_size: 60,
      })
      setDocuments(response.results)
    } catch {
      setError('Не удалось загрузить документы')
    } finally {
      setLoading(false)
    }
  }, [scope, query, ordering])

  useEffect(() => {
    // Поиск идёт с задержкой: запрос на каждую букву перегружает и сеть,
    // и полнотекстовый индекс.
    const timer = window.setTimeout(load, query ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const createDocument = async () => {
    try {
      const document = await api.createDocument({})
      navigate(`/docs/${document.id}`)
    } catch {
      setError('Не удалось создать документ')
    }
  }

  const toggleStar = async (document: DocumentSummary) => {
    const { is_starred } = await api.starDocument(document.id)
    setDocuments((prev) =>
      prev.map((item) => (item.id === document.id ? { ...item, is_starred } : item)),
    )
  }

  const removeDocument = async (document: DocumentSummary) => {
    if (scope === 'trash') {
      if (!window.confirm(`Удалить «${document.title}» безвозвратно?`)) return
      await api.deleteDocument(document.id, true)
    } else {
      await api.deleteDocument(document.id)
    }
    setDocuments((prev) => prev.filter((item) => item.id !== document.id))
  }

  const restoreDocument = async (document: DocumentSummary) => {
    await api.restoreDocument(document.id)
    setDocuments((prev) => prev.filter((item) => item.id !== document.id))
  }

  const changeView = (next: View) => {
    setView(next)
    localStorage.setItem('docs.view', next)
  }

  const changeScope = (next: Scope) => {
    setQuery('')
    setParams(next === 'active' ? {} : { scope: next })
  }

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="sticky top-0 z-10 border-b border-hairline bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-3">
          <Link to="/docs" className="text-lg font-semibold text-ink">
            Документы
          </Link>

          <div className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по названию и содержимому"
              aria-label="Поиск документов"
              className="w-full rounded-full border border-hairline bg-surface-muted px-4 py-2 text-sm outline-none focus:border-accent"
            />
          </div>

          <button
            type="button"
            onClick={createDocument}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Новый документ
          </button>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-ink-muted sm:inline">{user?.display_name}</span>
            <button
              type="button"
              onClick={() => logout().then(() => navigate('/login'))}
              className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              Выйти
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {SCOPES.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => changeScope(item.value)}
              aria-current={scope === item.value ? 'page' : undefined}
              className={[
                'rounded-full px-4 py-1.5 text-sm transition-colors',
                scope === item.value
                  ? 'bg-accent text-white'
                  : 'border border-hairline bg-surface hover:bg-surface-muted',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}

          <div className="ml-auto flex items-center gap-2">
            <select
              value={ordering}
              onChange={(event) => setOrdering(event.target.value)}
              aria-label="Сортировка"
              className="rounded border border-hairline bg-surface px-2 py-1.5 text-sm"
            >
              {SORTS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <div className="flex overflow-hidden rounded border border-hairline">
              <button
                type="button"
                onClick={() => changeView('grid')}
                aria-pressed={view === 'grid'}
                aria-label="Сеткой"
                className={`px-3 py-1.5 text-sm ${view === 'grid' ? 'bg-surface-muted' : 'bg-surface'}`}
              >
                ▦
              </button>
              <button
                type="button"
                onClick={() => changeView('list')}
                aria-pressed={view === 'list'}
                aria-label="Списком"
                className={`px-3 py-1.5 text-sm ${view === 'list' ? 'bg-surface-muted' : 'bg-surface'}`}
              >
                ☰
              </button>
            </div>
          </div>
        </div>

        {loading && <p className="py-12 text-center text-ink-muted">Загрузка…</p>}

        {error && !loading && (
          <div className="py-12 text-center">
            <p className="mb-3 text-red-600">{error}</p>
            <button type="button" onClick={load} className="rounded border border-hairline px-4 py-2 text-sm">
              Повторить
            </button>
          </div>
        )}

        {!loading && !error && documents.length === 0 && (
          <div className="py-16 text-center">
            <p className="mb-1 text-ink">
              {scope === 'trash' ? 'Корзина пуста' : 'Пока нет документов'}
            </p>
            <p className="text-sm text-ink-muted">
              {scope === 'trash'
                ? 'Удалённые документы хранятся здесь 30 дней'
                : 'Создайте первый документ, чтобы начать'}
            </p>
          </div>
        )}

        {!loading && !error && documents.length > 0 && (
          <ul
            className={
              view === 'grid'
                ? 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4'
                : 'divide-y divide-hairline rounded-lg border border-hairline bg-surface'
            }
          >
            {documents.map((document) => (
              <li
                key={document.id}
                className={
                  view === 'grid'
                    ? 'group rounded-lg border border-hairline bg-surface p-3 transition-shadow hover:shadow-md'
                    : 'flex items-center gap-3 px-4 py-3'
                }
              >
                <Link to={`/docs/${document.id}`} className="block min-w-0 flex-1">
                  {view === 'grid' && (
                    <div className="mb-3 h-32 overflow-hidden rounded border border-hairline bg-white p-2 text-[7px] leading-tight text-gray-500">
                      {document.preview || 'Пустой документ'}
                    </div>
                  )}
                  <p className="truncate font-medium text-ink">{document.title}</p>
                  <p className="truncate text-xs text-ink-muted">
                    {document.owner.display_name} · {formatDate(document.last_edited_at)}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center gap-1">
                  {scope === 'trash' ? (
                    <>
                      <button
                        type="button"
                        onClick={() => restoreDocument(document)}
                        className="rounded px-2 py-1 text-xs hover:bg-surface-muted"
                      >
                        Восстановить
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDocument(document)}
                        className="rounded px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                      >
                        Удалить
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggleStar(document)}
                        aria-label={document.is_starred ? 'Убрать из избранного' : 'В избранное'}
                        className="rounded px-2 py-1 hover:bg-surface-muted"
                      >
                        {document.is_starred ? '★' : '☆'}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDocument(document)}
                        aria-label="В корзину"
                        className="rounded px-2 py-1 text-ink-muted hover:bg-surface-muted"
                      >
                        🗑
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  )
}
