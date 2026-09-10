/**
 * Связь документа Yjs с сервером.
 *
 * Готового y-websocket здесь нет намеренно: сервер говорит на своём протоколе
 * (двоичные приращения плюс служебные сообщения в JSON), а присутствие
 * и курсоры идут отдельным каналом.
 *
 * Работа без сети держится на двух вещах: правки копятся в самом документе Yjs
 * и сохраняются в IndexedDB, а при восстановлении связи уходят на сервер
 * приращением. Слияние делает CRDT — ни одна из сторон ничего не затирает.
 */
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { Awareness } from 'y-protocols/awareness'
import type { Presence, SaveStatus } from '@/types'

const WS_URL = import.meta.env.VITE_WS_URL ?? `ws://${window.location.host}/ws`

// Пауза перед повторным подключением растёт до этой границы: сервер,
// который лежит, не должен получать шквал попыток от каждой вкладки.
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15000

// Как часто вкладка отправляет свёрнутое состояние. Сервер сам сливать
// приращения не умеет, поэтому снимок делает тот, у кого документ открыт.
const SNAPSHOT_INTERVAL_MS = 60_000

type ProviderOptions = {
  documentId: string
  token: string
  linkToken?: string
  user: Presence
  onStatus?: (status: SaveStatus) => void
  onPresence?: (users: Presence[]) => void
  onEvent?: (event: Record<string, unknown>) => void
  getContent?: () => Record<string, unknown> | null
}

export class DocumentProvider {
  readonly doc: Y.Doc
  readonly awareness: Awareness
  private socket: WebSocket | null = null
  private persistence: IndexeddbPersistence | null = null
  private reconnectDelay = RECONNECT_MIN_MS
  private reconnectTimer: number | null = null
  private snapshotTimer: number | null = null
  private destroyed = false
  private readonly presence = new Map<string, Presence>()

  constructor(private readonly options: ProviderOptions) {
    this.doc = new Y.Doc()
    this.awareness = new Awareness(this.doc)

    this.awareness.setLocalStateField('user', {
      name: options.user.name,
      color: options.user.color,
      id: options.user.id,
    })

    // Локальная копия: документ открывается мгновенно и работает без сети.
    this.persistence = new IndexeddbPersistence(`doc-${options.documentId}`, this.doc)

    this.doc.on('update', this.handleLocalUpdate)
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)

    this.connect()
    this.snapshotTimer = window.setInterval(this.sendSnapshot, SNAPSHOT_INTERVAL_MS)
  }

  // ------------------------------ Соединение ------------------------------

  private connect = () => {
    if (this.destroyed) return

    const params = new URLSearchParams({ token: this.options.token })
    if (this.options.linkToken) params.set('link', this.options.linkToken)

    const socket = new WebSocket(`${WS_URL}/documents/${this.options.documentId}/?${params}`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    socket.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS
      this.options.onStatus?.('syncing')

      // Всё, что накопилось без сети, уходит одним приращением.
      const update = Y.encodeStateAsUpdate(this.doc)
      socket.send(update)
      this.options.onStatus?.('saved')
    }

    socket.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Приращение от другого участника. Применяем с меткой источника,
        // чтобы не отправить его обратно и не устроить круговорот.
        Y.applyUpdate(this.doc, new Uint8Array(event.data), 'remote')
        return
      }
      this.handleMessage(event.data)
    }

    socket.onclose = (event) => {
      this.socket = null
      // 4401/4403/4404 — отказ в доступе. Переподключаться бессмысленно.
      if (this.destroyed || (event.code >= 4401 && event.code <= 4404)) {
        this.options.onStatus?.(event.code >= 4401 ? 'error' : 'offline')
        return
      }
      this.options.onStatus?.('offline')
      this.scheduleReconnect()
    }

    socket.onerror = () => {
      this.options.onStatus?.('offline')
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer !== null) return
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS)
  }

  // ------------------------------- Сообщения -------------------------------

  private handleMessage(raw: string) {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    switch (message.type) {
      case 'sync_init':
        this.options.onStatus?.('saved')
        break
      case 'user_join':
      case 'presence_update': {
        const user = message.user as Presence | undefined
        if (user) this.presence.set(user.id, user)
        this.emitPresence()
        break
      }
      case 'user_leave': {
        const user = message.user as Presence | undefined
        if (user) this.presence.delete(user.id)
        this.emitPresence()
        break
      }
      case 'cursor_update':
      case 'selection_update': {
        const user = message.user as Presence | undefined
        if (user) this.presence.set(user.id, user)
        this.emitPresence()
        this.options.onEvent?.(message)
        break
      }
      default:
        // Комментарии, предложения и прочие события — наверх, в интерфейс.
        this.options.onEvent?.(message)
    }
  }

  private emitPresence() {
    this.options.onPresence?.(Array.from(this.presence.values()))
  }

  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // Чужое приращение обратно не отправляем.
    if (origin === 'remote') return

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(update)
      this.options.onStatus?.('saved')
    } else {
      // Правка не потеряна: она в документе и в IndexedDB, уйдёт при связи.
      this.options.onStatus?.('offline')
    }
  }

  private sendSnapshot = () => {
    if (this.socket?.readyState !== WebSocket.OPEN) return

    const content = this.options.getContent?.()
    if (!content) return

    const state = Y.encodeStateAsUpdate(this.doc)
    let binary = ''
    state.forEach((byte) => {
      binary += String.fromCharCode(byte)
    })

    this.socket.send(
      JSON.stringify({ type: 'snapshot', content, state: window.btoa(binary) }),
    )
  }

  private handleOnline = () => {
    this.options.onStatus?.('syncing')
    if (!this.socket) this.connect()
  }

  private handleOffline = () => {
    this.options.onStatus?.('offline')
  }

  // ------------------------------- Отправка -------------------------------

  sendCursor(cursor: unknown, selection: unknown) {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ type: 'cursor_update', cursor, selection }))
  }

  /** Сохранить состояние немедленно — при закрытии вкладки или по команде. */
  flush() {
    this.sendSnapshot()
  }

  destroy() {
    this.destroyed = true
    this.flush()

    if (this.snapshotTimer !== null) window.clearInterval(this.snapshotTimer)
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer)

    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('offline', this.handleOffline)

    this.doc.off('update', this.handleLocalUpdate)
    this.socket?.close()
    this.persistence?.destroy()
    this.awareness.destroy()
    this.doc.destroy()
  }
}
