/**
 * Колокольчик с уведомлениями.
 *
 * Список загружается при открытии, а не на каждой странице: непрочитанных
 * обычно единицы, и держать их в памяти всё время незачем. Счётчик
 * обновляется по таймеру — отдельного канала для уведомлений на сервере нет.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAnchoredPosition } from './anchored'
import { api } from '@/api'
import { formatRelative } from '@/utils/date'
import { BellIcon } from './icons'
import type { Notification } from '@/types'

const POLL_INTERVAL_MS = 60_000

export function NotificationsMenu() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // Панель шириной 320 пикселей у правого края узкого экрана уезжала за него
  // наполовину. Через портал ширина и сторона считаются по месту на экране.
  const position = useAnchoredPosition(root, open, 'right', false)
  const id = useId()

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await api.listNotifications()
      setItems(response.results)
      setUnread(response.unread_count)
    } catch {
      setError('Не удалось загрузить уведомления')
    } finally {
      setLoading(false)
    }
  }, [])

  // Счётчик нужен и с закрытым списком, поэтому опрос идёт постоянно.
  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const response = await api.listNotifications(true)
        if (!cancelled) setUnread(response.unread_count)
      } catch {
        // Молча: сбой опроса не повод показывать ошибку поверх работы.
      }
    }

    poll()
    const timer = window.setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    load()

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || panel.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, load])

  const openNotification = async (notification: Notification) => {
    setOpen(false)
    if (!notification.is_read) {
      setUnread((value) => Math.max(0, value - 1))
      api.readNotification(notification.id).catch(() => undefined)
    }
    if (notification.document) navigate(`/documents/${notification.document}`)
  }

  const readAll = async () => {
    await api.readAllNotifications()
    setUnread(0)
    setItems((prev) => prev.map((item) => ({ ...item, is_read: true })))
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Уведомления, непрочитанных: ${unread}` : 'Уведомления'}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="relative rounded-full border border-hairline p-2 text-ink-muted hover:bg-surface-muted hover:text-accent"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          id={id}
          ref={panel}
          style={position}
          className="animate-pop w-80 overflow-y-auto overscroll-contain rounded-2xl border border-hairline bg-surface shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <h2 className="flex-1 text-sm font-semibold text-ink">Уведомления</h2>
            {unread > 0 && (
              <button type="button" onClick={readAll} className="text-xs text-accent hover:underline">
                Прочитать все
              </button>
            )}
          </div>

          {loading && <p className="px-3 py-6 text-center text-sm text-ink-muted">Загрузка…</p>}

          {error && !loading && (
            <div className="px-3 py-6 text-center">
              <p className="mb-2 text-sm text-red-600">{error}</p>
              <button type="button" onClick={load} className="text-xs text-accent hover:underline">
                Повторить
              </button>
            </div>
          )}

          {!loading && !error && items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">Пока ничего нового</p>
          )}

          {!loading && !error && items.length > 0 && (
            <ul className="divide-y divide-hairline">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openNotification(item)}
                    className={[
                      'block w-full px-3 py-2.5 text-left hover:bg-surface-muted',
                      item.is_read ? '' : 'bg-accent/5',
                    ].join(' ')}
                  >
                    <p className="text-sm text-ink">{item.message}</p>
                    <p className="mt-0.5 text-xs text-ink-muted">
                      {item.document_title && `${item.document_title} · `}
                      {formatRelative(item.created_at)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
