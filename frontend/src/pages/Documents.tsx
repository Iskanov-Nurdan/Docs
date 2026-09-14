/**
 * Список документов. Одна страница обслуживает все разделы: свои документы,
 * доступные, избранное, корзину и папку — они отличаются только выборкой,
 * а действия и оформление в них общие.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { DocumentList, type ListView } from '@/components/DocumentList'
import { GridViewIcon, ListViewIcon } from '@/components/icons'
import { Select, type SelectOption } from '@/components/Select'
import { api } from '@/api'
import { folderPath, useFolders } from '@/store/folders'
import type { DocumentSummary } from '@/types'

export type DocumentsScope = 'active' | 'starred' | 'shared' | 'trash' | 'folder'

const TITLES: Record<DocumentsScope, string> = {
  active: 'Мои документы',
  starred: 'Избранное',
  shared: 'Доступные мне',
  trash: 'Корзина',
  folder: 'Папка',
}

const EMPTY: Record<DocumentsScope, { title: string; hint: string }> = {
  active: { title: 'Пока нет документов', hint: 'Создайте первый документ, чтобы начать' },
  starred: { title: 'В избранном пусто', hint: 'Отметьте документ звёздочкой — он появится здесь' },
  shared: { title: 'Вам пока не давали доступ', hint: 'Здесь появятся чужие документы, открытые вам' },
  trash: { title: 'Корзина пуста', hint: 'Удалённые документы хранятся здесь 30 дней' },
  folder: { title: 'Папка пуста', hint: 'Перенесите сюда документ или создайте новый' },
}

const SORTS: SelectOption<string>[] = [
  { value: '-last_edited_at', label: 'Сначала изменённые' },
  { value: '-created_at', label: 'Сначала новые' },
  { value: 'title', label: 'По названию (А–Я)' },
  { value: '-title', label: 'По названию (Я–А)' },
]

/**
 * Заглушка на время загрузки.
 *
 * Повторяет раскладку списка, поэтому при появлении данных ничего не
 * прыгает — а по числу полос сразу видно, что грузится список документов.
 */
function ListSkeleton({ view }: { view: ListView }) {
  const items = Array.from({ length: view === 'grid' ? 8 : 6 }, (_, index) => index)

  return (
    <div className="animate-fade" aria-hidden="true">
      {view === 'grid' ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {items.map((item) => (
            <div key={item} className="rounded-lg border border-hairline bg-surface p-3">
              <div className="skeleton mb-3 h-32 w-full" />
              <div className="skeleton mb-2 h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : (
        <div className="divide-y divide-hairline rounded-lg border border-hairline bg-surface">
          {items.map((item) => (
            <div key={item} className="flex items-center gap-3 px-4 py-3">
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton hidden h-3 w-32 sm:block" />
              <div className="skeleton hidden h-3 w-24 md:block" />
            </div>
          ))}
        </div>
      )}
      <p className="sr-only" role="status">
        Загрузка документов
      </p>
    </div>
  )
}

export function DocumentsPage({ scope }: { scope: DocumentsScope }) {
  const { id: folderId } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const { folders, load: loadFolders } = useFolders()

  const query = params.get('q') ?? ''
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  // Сколько всего таблиц у человека и сколько уже показано: без этого список
  // обрывался на первой странице выдачи, и до остальных было не добраться.
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [ordering, setOrdering] = useState('-last_edited_at')
  const [view, setView] = useState<ListView>(
    () => (localStorage.getItem('docs.view') as ListView) ?? 'grid',
  )

  const PAGE_SIZE = 60

  const fetchPage = useCallback(
    (page: number) =>
      api.listDocuments({
        scope: query ? 'search' : scope === 'folder' ? 'active' : scope,
        q: query || undefined,
        folder: scope === 'folder' ? folderId : undefined,
        ordering,
        page,
        page_size: PAGE_SIZE,
      }),
    [scope, folderId, query, ordering],
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetchPage(1)
      setDocuments(response.results)
      setTotal(response.count)
    } catch {
      setError('Не удалось загрузить документы')
    } finally {
      setLoading(false)
    }
  }, [fetchPage])

  /** Следующая страница выдачи — по кнопке, а не по прокрутке. */
  const loadMore = async () => {
    if (loadingMore) return
    setLoadingMore(true)
    try {
      const next = Math.floor(documents.length / PAGE_SIZE) + 1
      const response = await fetchPage(next)
      // Сверяем по идентификатору: пока человек читал список, одна из таблиц
      // могла уехать в корзину, и тогда страницы сдвигаются.
      setDocuments((current) => {
        const seen = new Set(current.map((item) => item.id))
        return [...current, ...response.results.filter((item) => !seen.has(item.id))]
      })
      setTotal(response.count)
    } catch {
      setError('Не удалось загрузить документы')
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    load()
  }, [load])

  const changeView = (next: ListView) => {
    setView(next)
    localStorage.setItem('docs.view', next)
  }

  const path = scope === 'folder' && folderId ? folderPath(folders, folderId) : []
  const title = query
    ? `Поиск: ${query}`
    : scope === 'folder'
      ? (path[path.length - 1]?.name ?? TITLES.folder)
      : TITLES[scope]

  const empty = query
    ? { title: 'Ничего не найдено', hint: 'Попробуйте другие слова или проверьте раскладку' }
    : EMPTY[scope]

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Select label="Сортировка" value={ordering} options={SORTS} onChange={setOrdering} />

      <div className="flex overflow-hidden rounded-full border border-hairline">
        <button
          type="button"
          onClick={() => changeView('grid')}
          aria-pressed={view === 'grid'}
          aria-label="Сеткой"
          className={`px-3 py-2 ${view === 'grid' ? 'bg-accent/10 text-accent' : 'bg-surface text-ink-muted'}`}
        >
          <GridViewIcon size={16} />
        </button>
        <button
          type="button"
          onClick={() => changeView('list')}
          aria-pressed={view === 'list'}
          aria-label="Списком"
          className={`px-3 py-2 ${view === 'list' ? 'bg-accent/10 text-accent' : 'bg-surface text-ink-muted'}`}
        >
          <ListViewIcon size={16} />
        </button>
      </div>
    </div>
  )

  useEffect(() => {
    if (scope === 'folder') loadFolders()
  }, [scope, loadFolders])

  return (
    <AppLayout title={title} actions={actions}>
      {path.length > 0 && (
        <nav aria-label="Путь" className="mb-3 flex flex-wrap items-center gap-1 text-sm text-ink-muted">
          <Link to="/documents" className="hover:underline">
            Мои документы
          </Link>
          {path.map((folder, index) => (
            <span key={folder.id} className="flex items-center gap-1">
              <span aria-hidden="true">/</span>
              {index === path.length - 1 ? (
                <span className="text-ink">{folder.name}</span>
              ) : (
                <Link to={`/folders/${folder.id}`} className="hover:underline">
                  {folder.name}
                </Link>
              )}
            </span>
          ))}
        </nav>
      )}

      {loading && <ListSkeleton view={view} />}

      {error && !loading && (
        <div className="animate-fade py-12 text-center">
          <p className="mb-3 text-red-600">{error}</p>
          <button
            type="button"
            onClick={load}
            className="rounded border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Повторить
          </button>
        </div>
      )}

      {!loading && !error && documents.length === 0 && (
        <div className="animate-rise py-16 text-center">
          <p className="mb-1 text-ink">{empty.title}</p>
          <p className="text-sm text-ink-muted">{empty.hint}</p>
        </div>
      )}

      {!loading && !error && documents.length > 0 && (
        <DocumentList
          key={`${scope}-${folderId ?? ''}-${query}`}
          documents={documents}
          view={view}
          query={query}
          trash={scope === 'trash'}
          onUpdate={(document) =>
            setDocuments((prev) =>
              // Снятая звёздочка убирает документ из «Избранного» сразу:
              // оставлять его в разделе, которому он больше не принадлежит, нельзя.
              scope === 'starred' && !document.is_starred
                ? prev.filter((item) => item.id !== document.id)
                : prev.map((item) => (item.id === document.id ? document : item)),
            )
          }
          onRemove={(id) => {
            setDocuments((prev) => prev.filter((item) => item.id !== id))
            setTotal((count) => Math.max(count - 1, 0))
          }}
        />
      )}

      {/* Кнопка, а не подгрузка при прокрутке: в длинном списке человек чаще
          ищет поиском, а самопроизвольная догрузка на телефоне мешает
          добраться до конца страницы. */}
      {!loading && documents.length > 0 && documents.length < total && (
        <div className="mt-4 flex flex-col items-center gap-1">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-full border border-hairline px-4 py-2 text-sm text-ink hover:bg-surface-muted disabled:opacity-50"
          >
            {loadingMore ? 'Загружаем…' : 'Показать ещё'}
          </button>
          <span className="text-xs text-ink-muted">
            Показано {documents.length} из {total}
          </span>
        </div>
      )}
    </AppLayout>
  )
}
