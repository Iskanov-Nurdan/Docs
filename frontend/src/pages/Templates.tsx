/** Галерея шаблонов: документ создаётся уже заполненным. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { api } from '@/api'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { SheetIcon, TrashIcon } from '@/components/icons'
import type { Template } from '@/types'

export function TemplatesPage() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Template | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      // Готовые блоки (callout, карточка) вставляются внутрь документа,
      // отдельным документом они не создаются — в галерее им не место.
      setTemplates(await api.listTemplates({ blocks: 'false' }))
    } catch {
      setError('Не удалось загрузить шаблоны')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const categories = useMemo(() => {
    const seen = new Map<string, string>()
    templates.forEach((template) => seen.set(template.category, template.category_display))
    return Array.from(seen, ([value, label]) => ({ value, label }))
  }, [templates])

  const visible = category ? templates.filter((item) => item.category === category) : templates

  const createFrom = async (template: Template | null) => {
    setCreating(template?.id ?? 'blank')
    setError('')
    try {
      const document = await api.createDocument(
        template ? { template_id: template.id } : { title: 'Новая таблица' },
      )
      navigate(`/documents/${document.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать документ')
      setCreating(null)
    }
  }

  return (
    <AppLayout title="Шаблоны">
      {categories.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setCategory('')}
            aria-pressed={category === ''}
            className={[
              'rounded-full px-4 py-1.5 text-sm transition-colors',
              category === '' ? 'bg-accent text-white' : 'border border-hairline bg-surface hover:bg-surface-muted',
            ].join(' ')}
          >
            Все
          </button>
          {categories.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setCategory(item.value)}
              aria-pressed={category === item.value}
              className={[
                'rounded-full px-4 py-1.5 text-sm',
                category === item.value
                  ? 'bg-accent text-white'
                  : 'border border-hairline bg-surface hover:bg-surface-muted',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {loading && <p className="py-12 text-center text-ink-muted">Загрузка…</p>}

      {error && !loading && (
        <div className="py-12 text-center">
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

      {!loading && !error && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          <li>
            <button
              type="button"
              onClick={() => createFrom(null)}
              disabled={creating !== null}
              className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-hairline bg-surface p-6 text-sm text-ink-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              <SheetIcon size={26} />
              Пустая таблица
            </button>
          </li>

          {visible.map((template) => (
            <li key={template.id} className="relative">
              {/* Свою заготовку человек может убрать; общие заводит админ. */}
              {template.is_personal && (
                <button
                  type="button"
                  onClick={() => setRemoving(template)}
                  aria-label={`Удалить шаблон «${template.title}»`}
                  className="absolute right-2 top-2 z-10 rounded-full bg-surface/90 p-1.5 text-ink-muted hover:bg-surface-muted hover:text-red-600"
                >
                  <TrashIcon size={15} />
                </button>
              )}
              <button
                type="button"
                onClick={() => createFrom(template)}
                disabled={creating !== null}
                className="flex h-full w-full flex-col rounded-lg border border-hairline bg-surface p-3 text-left transition-shadow hover:shadow-md disabled:opacity-50"
              >
                <span className="mb-3 flex h-32 items-center justify-center overflow-hidden rounded border border-hairline bg-surface-muted">
                  {template.preview_image ? (
                    <img
                      src={template.preview_image}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <SheetIcon size={30} className="text-ink-muted" />
                  )}
                </span>
                <span className="font-medium text-ink">
                  {creating === template.id ? 'Создание…' : template.title}
                </span>
                <span className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                  {template.description || (template.is_personal ? 'Мой шаблон' : template.category_display)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && !error && visible.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-muted">
          В этой категории шаблонов пока нет
        </p>
      )}

      {removing && (
        <ConfirmDialog
          title="Удалить шаблон"
          message={`Шаблон «${removing.title}» исчезнет из галереи. Таблицы, созданные по нему, останутся на месте.`}
          confirmLabel="Удалить"
          danger
          onConfirm={async () => {
            await api.deleteTemplate(removing.id)
            setTemplates((current) => current.filter((item) => item.id !== removing.id))
            setRemoving(null)
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </AppLayout>
  )
}
