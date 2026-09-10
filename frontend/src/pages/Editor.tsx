/** Страница редактора: шапка, режимы, участники, статус сохранения. */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, tokens } from '@/api'
import { DocumentEditor } from '@/editor/DocumentEditor'
import { useAuth } from '@/store/auth'
import type { Document, EditorMode, Presence, Role, SaveStatus } from '@/types'

const STATUS_LABELS: Record<SaveStatus, string> = {
  saved: 'Все изменения сохранены',
  saving: 'Сохранение…',
  syncing: 'Синхронизация…',
  offline: 'Нет сети — правки сохраняются локально',
  error: 'Не удалось сохранить',
}

const MODE_LABELS: Record<EditorMode, string> = {
  editing: 'Редактирование',
  suggesting: 'Советы',
  viewing: 'Просмотр',
}

/** Что доступно роли: комментатор не правит текст, но предлагает правки. */
function allowedModes(role: Role | null): EditorMode[] {
  if (role === 'owner' || role === 'editor') return ['editing', 'suggesting', 'viewing']
  if (role === 'commenter') return ['suggesting', 'viewing']
  return ['viewing']
}

export function EditorPage() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const linkToken = params.get('link') ?? undefined
  const { user } = useAuth()

  const [document, setDocument] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [presence, setPresence] = useState<Presence[]>([])
  const [mode, setMode] = useState<EditorMode>('editing')
  const [title, setTitle] = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .getDocument(id, linkToken)
      .then((loaded) => {
        setDocument(loaded)
        setTitle(loaded.title)
        const modes = allowedModes(loaded.my_role)
        setMode(modes[0])
      })
      .catch(() => setError('Документ не найден или недоступен'))
      .finally(() => setLoading(false))
  }, [id, linkToken])

  const renameDocument = useCallback(async () => {
    if (!document || title === document.title) return
    const trimmed = title.trim() || 'Без названия'
    try {
      await api.updateDocument(document.id, { title: trimmed })
      setDocument((prev) => (prev ? { ...prev, title: trimmed } : prev))
      setTitle(trimmed)
    } catch {
      // Название вернётся к сохранённому — иначе в шапке останется то,
      // чего нет на сервере.
      setTitle(document.title)
    }
  }, [document, title])

  if (loading) {
    return <p className="p-12 text-center text-ink-muted">Загрузка документа…</p>
  }

  if (error || !document || !user) {
    return (
      <div className="p-12 text-center">
        <p className="mb-3 text-ink">{error || 'Документ недоступен'}</p>
        <Link to="/docs" className="text-accent hover:underline">
          Вернуться к списку
        </Link>
      </div>
    )
  }

  const modes = allowedModes(document.my_role)
  const me: Presence = {
    id: user.id,
    name: user.display_name,
    initials: user.initials ?? user.display_name.slice(0, 2).toUpperCase(),
    color: user.cursor_color ?? '#2563eb',
    avatar: user.avatar,
  }

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="border-b border-hairline px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/docs" className="shrink-0 text-lg" aria-label="К списку документов">
            ←
          </Link>

          <div className="min-w-0 flex-1">
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={renameDocument}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
              }}
              disabled={document.my_role !== 'owner' && document.my_role !== 'editor'}
              aria-label="Название документа"
              className="w-full max-w-md rounded border border-transparent px-2 py-1 text-lg font-medium text-ink outline-none hover:border-hairline focus:border-accent disabled:hover:border-transparent"
            />
            <p className="px-2 text-xs text-ink-muted" role="status" aria-live="polite">
              {STATUS_LABELS[status]}
            </p>
          </div>

          <div className="flex items-center -space-x-2" aria-label="Кто сейчас в документе">
            {presence.slice(0, 5).map((participant) => (
              <span
                key={participant.id}
                title={participant.name}
                style={{ backgroundColor: participant.color }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-surface"
              >
                {participant.initials}
              </span>
            ))}
          </div>

          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as EditorMode)}
            aria-label="Режим работы"
            className="rounded border border-hairline bg-surface px-2 py-1.5 text-sm"
          >
            {modes.map((item) => (
              <option key={item} value={item}>
                {MODE_LABELS[item]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <DocumentEditor
        document={document}
        token={tokens.access ?? ''}
        linkToken={linkToken}
        user={me}
        mode={mode}
        onStatusChange={setStatus}
        onPresenceChange={setPresence}
      />
    </div>
  )
}
