/** Страница таблицы: шапка, участники, выгрузка, доступ и история. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api, tokens } from '@/api'
import { ExportMenu } from '@/components/ExportMenu'
import { ArrowLeftIcon, HistoryIcon, ShareIcon } from '@/components/icons'
import { Select } from '@/components/Select'
import { ShareDialog } from '@/components/ShareDialog'
import { VersionHistory } from '@/components/VersionHistory'
import { SpreadsheetEditor } from '@/spreadsheet/SpreadsheetEditor'
import { useAuth } from '@/store/auth'
import type { Document, EditorMode, LiveSnapshot, Presence, Role, SaveStatus, VersionDetail } from '@/types'

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

type Dialog = 'none' | 'share' | 'history'

/** Что доступно роли: таблицу правят владелец и редактор, остальные смотрят. */
function allowedModes(role: Role | null): EditorMode[] {
  if (role === 'owner' || role === 'editor') return ['editing', 'viewing']
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
  // Сбой сети или сервера — повод попробовать ещё раз, в отличие от «нет доступа».
  const [retryable, setRetryable] = useState(false)
  const [status, setStatus] = useState<SaveStatus>('saved')
  // Версия, которую выбрали в истории: таблица запишет её поверх себя.
  const [restoreRequest, setRestoreRequest] = useState<VersionDetail | null>(null)
  // Как достать из редактора то, что на экране, — для сохранения версии.
  const snapshot = useRef<(() => LiveSnapshot | null) | null>(null)
  const [presence, setPresence] = useState<Presence[]>([])
  const [mode, setMode] = useState<EditorMode>('editing')
  const [title, setTitle] = useState('')
  const [dialog, setDialog] = useState<Dialog>('none')

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const loaded = await api.getDocument(id, linkToken)
      setDocument(loaded)
      setTitle(loaded.title)
      setMode(allowedModes(loaded.my_role)[0])
      setError('')
      setRetryable(false)
    } catch (err) {
      // «Не найден» на обрыве связи отправлял человека искать таблицу,
      // которая на месте: нужно просто повторить.
      const transient = !(err instanceof ApiError) || err.status === 0 || err.status >= 500
      setRetryable(transient)
      setError(transient
        ? 'Не удалось загрузить документ: нет связи с сервером или он временно недоступен'
        : 'Документ не найден или недоступен')
    } finally {
      setLoading(false)
    }
  }, [id, linkToken])

  useEffect(() => {
    load()
  }, [load])

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
      <div className="animate-rise p-12 text-center">
        <p role="alert" className="mb-3 text-ink">{error || 'Документ недоступен'}</p>
        {retryable && (
          <button
            type="button"
            onClick={() => void load()}
            className="mb-3 mr-4 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Повторить
          </button>
        )}
        <Link to="/documents" className="text-accent hover:underline">
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
    color: user.cursor_color ?? '#2a7ad6',
    avatar: user.avatar,
  }

  return (
    <div className="flex h-dvh flex-col bg-surface">
      <header className="border-b border-hairline px-4 py-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to="/documents"
            aria-label="К списку таблиц"
            className="shrink-0 rounded-full p-1.5 text-ink-muted hover:bg-surface-muted"
          >
            <ArrowLeftIcon />
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

          <div className="flex items-center -space-x-2" aria-label="Кто сейчас в таблице">
            {presence.slice(0, 5).map((participant, index) => (
              <span
                key={participant.id}
                title={participant.name}
                style={{ backgroundColor: participant.color }}
                className={[
                  'h-7 w-7 items-center justify-center rounded-full text-xs font-semibold text-white ring-2 ring-surface sm:h-8 sm:w-8',
                  // Четвёртый и пятый участники видны только на широком экране:
                  // на телефоне этот ряд вытесняет кнопки в следующий.
                  index < 3 ? 'flex' : 'hidden sm:flex',
                ].join(' ')}
              >
                {participant.initials}
              </span>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <ExportMenu document={document} />

            <button
              type="button"
              onClick={() => setDialog('history')}
              className="flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              <HistoryIcon size={16} />
              {/* На телефоне остаётся один значок: подписи растягивают шапку
                  на лишний ряд, а он отнимает высоту у самой таблицы. */}
              <span className="hidden sm:inline">История</span>
            </button>

            <button
              type="button"
              onClick={() => setDialog('share')}
              className="flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              <ShareIcon size={16} />
              <span className="hidden sm:inline">Поделиться</span>
            </button>
          </div>

          {modes.length > 1 && (
            <Select
              label="Режим работы"
              value={mode}
              options={modes.map((item) => ({ value: item, label: MODE_LABELS[item] }))}
              onChange={setMode}
            />
          )}
        </div>
      </header>

      <SpreadsheetEditor
        document={document}
        token={tokens.access ?? ''}
        linkToken={linkToken}
        user={me}
        mode={mode}
        onStatusChange={setStatus}
        onPresenceChange={setPresence}
        restoreRequest={restoreRequest}
        snapshotRef={snapshot}
        onRestoreApplied={() => {
          setRestoreRequest(null)
          load()
        }}
      />

      {dialog === 'share' && (
        <ShareDialog
          document={document}
          onClose={() => setDialog('none')}
          onDocumentChange={setDocument}
          getSnapshot={() => snapshot.current?.() ?? null}
        />
      )}

      {dialog === 'history' && (
        <VersionHistory
          documentId={document.id}
          role={document.my_role}
          onClose={() => setDialog('none')}
          getSnapshot={() => snapshot.current?.() ?? null}
          onRestored={(version) => {
            setDialog('none')
            // Версию в таблицу записывает редактор — обычной правкой, которая
            // дойдёт до всех открытых вкладок.
            setRestoreRequest(version)
          }}
        />
      )}
    </div>
  )
}
