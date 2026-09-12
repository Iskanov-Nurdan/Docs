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
import { refreshTokens } from '@/api'
import type { Presence, SaveStatus } from '@/types'

// Адрес канала по умолчанию — тот же узел, что отдал страницу.
// Схема выбирается по странице: на https обычный ws браузер заблокирует.
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`

// Пауза перед повторным подключением растёт до этой границы: сервер,
// который лежит, не должен получать шквал попыток от каждой вкладки.
const RECONNECT_MIN_MS = 1000
const RECONNECT_MAX_MS = 15000

// Как часто вкладка отправляет свёрнутое состояние. Сервер сам сливать
// приращения не умеет, поэтому снимок делает тот, у кого документ открыт.
const SNAPSHOT_INTERVAL_MS = 60_000

/**
 * Участник из сообщения сервера.
 *
 * Приведение типом здесь не годится: участник без идентификатора ложился
 * в список под ключом «undefined» и занимал там чужое место.
 */
function asPresence(value: unknown): Presence | null {
  if (!value || typeof value !== 'object') return null
  const user = value as Partial<Presence>
  return typeof user.id === 'string' && user.id !== '' ? (user as Presence) : null
}

type ProviderOptions = {
  documentId: string
  /** Запасной вариант: используется, если getToken не задан. */
  token: string
  /** Действующий токен на момент подключения — он обновляется по ходу работы. */
  getToken?: () => string | null
  linkToken?: string
  user: Presence
  onStatus?: (status: SaveStatus) => void
  onPresence?: (users: Presence[]) => void
  onEvent?: (event: Record<string, unknown>) => void
  getContent?: () => Record<string, unknown> | null
  /**
   * Документ готов к работе: местная копия поднята и сервер прислал своё.
   * `hasState` — хранится ли книга на сервере. Местную копию вызывающий
   * проверяет сам: к этому моменту она уже в документе.
   */
  onReady?: (hasState: boolean) => void
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
  // Готовность собирается из двух источников: локальной копии и сервера.
  // Заполнять книгу до того, как пришли оба, нельзя — данные задвоятся.
  private storageReady = false
  private serverReady = false
  private serverHasState = false
  private readyAnnounced = false
  /** Обновление токена после отказа 4401 пробуем один раз на соединение. */
  private refreshedForAuth = false
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
    this.persistence.on('synced', () => {
      this.storageReady = true
      this.announceReady()
    })

    this.doc.on('update', this.handleLocalUpdate)
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)

    this.connect()
    this.snapshotTimer = window.setInterval(this.sendSnapshot, SNAPSHOT_INTERVAL_MS)
  }

  // ------------------------------ Соединение ------------------------------

  /**
   * Токен для подключения.
   *
   * Берётся в момент подключения, а не при создании провайдера. Токен доступа
   * живёт полчаса; замороженный в поле, он протухал прямо во вкладке, и первый
   * же обрыв связи после получаса заканчивался отказом 4401 навсегда.
   */
  private currentToken(): string {
    return this.options.getToken?.() ?? this.options.token ?? ''
  }

  private connect = () => {
    if (this.destroyed) return

    // Запланированный повтор больше не нужен: подключаемся прямо сейчас.
    // Без этого событие «сеть появилась» и сработавший таймер открывали два
    // сокета сразу.
    this.cancelReconnect()
    this.closeSocket()

    const params = new URLSearchParams({ token: this.currentToken() })
    if (this.options.linkToken) params.set('link', this.options.linkToken)

    const socket = new WebSocket(`${WS_URL}/documents/${this.options.documentId}/?${params}`)
    socket.binaryType = 'arraybuffer'
    this.socket = socket

    socket.onopen = () => {
      if (this.socket !== socket) return
      this.reconnectDelay = RECONNECT_MIN_MS
      this.refreshedForAuth = false
      this.options.onStatus?.('syncing')

      // Всё, что накопилось без сети, уходит одним приращением.
      const update = Y.encodeStateAsUpdate(this.doc)
      socket.send(update)
      this.options.onStatus?.('saved')
    }

    socket.onmessage = (event) => {
      // Сообщение от сокета, который уже сменили, к делу не относится.
      if (this.socket !== socket) return

      if (event.data instanceof ArrayBuffer) {
        // Приращение от другого участника. Применяем с меткой источника,
        // чтобы не отправить его обратно и не устроить круговорот.
        Y.applyUpdate(this.doc, new Uint8Array(event.data), 'remote')
        return
      }
      this.handleMessage(event.data)
    }

    socket.onclose = (event) => {
      // Закрылся не тот сокет, с которым мы сейчас работаем: его закрыли мы
      // сами при переподключении. Обнулять ссылку на живой сокет нельзя —
      // именно из-за этого правки переставали уходить при открытом соединении,
      // а человек видел «нет сети».
      if (this.socket !== socket) return
      this.socket = null

      if (this.destroyed) return

      // 4401 — токен не принят. Один раз пробуем обновить пару и вернуться:
      // за полчаса работы во вкладке токен успевает протухнуть, и сдаваться
      // на этом навсегда неправильно.
      if (event.code === 4401 && !this.refreshedForAuth) {
        this.refreshedForAuth = true
        this.options.onStatus?.('syncing')
        void refreshTokens().then((renewed) => {
          if (this.destroyed) return
          if (renewed) this.connect()
          else this.options.onStatus?.('error')
        })
        return
      }

      // 4403/4404 — доступа нет и не будет: чужой документ или он удалён.
      if (event.code >= 4401 && event.code <= 4404) {
        this.options.onStatus?.('error')
        return
      }

      this.options.onStatus?.('offline')
      this.scheduleReconnect()
    }

    socket.onerror = () => {
      if (this.socket !== socket) return
      this.options.onStatus?.('offline')
    }
  }

  /** Закрывает текущий сокет, не давая его onclose планировать переподключение. */
  private closeSocket() {
    const socket = this.socket
    if (!socket) return
    this.socket = null
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    socket.close()
  }

  private cancelReconnect() {
    if (this.reconnectTimer === null) return
    window.clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
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
        this.serverReady = true
        this.serverHasState =
          Boolean(message.has_state) || Number(message.updates_count ?? 0) > 0
        this.announceReady()
        break
      case 'user_join':
      case 'presence_update': {
        const user = asPresence(message.user)
        if (user) this.presence.set(user.id, user)
        this.emitPresence()
        break
      }
      case 'user_leave': {
        const user = asPresence(message.user)
        if (user) this.presence.delete(user.id)
        this.emitPresence()
        break
      }
      case 'cursor_update':
      case 'selection_update': {
        const user = asPresence(message.user)
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

  private announceReady() {
    if (this.readyAnnounced || !this.storageReady || !this.serverReady) return
    this.readyAnnounced = true
    this.options.onReady?.(this.serverHasState)
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
    // До готовности книга в памяти ещё пуста, а в базе у документа уже может
    // лежать содержимое — из шаблона или из перенесённого файла. Снимок такой
    // книги затёр бы его насовсем: сервер хранит последний присланный.
    if (!this.readyAnnounced) return

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
    // Открытое соединение трогать не за чем: событие «сеть появилась»
    // приходит и тогда, когда связь не терялась.
    if (this.socket?.readyState === WebSocket.OPEN) return
    this.options.onStatus?.('syncing')
    this.connect()
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
    this.cancelReconnect()

    window.removeEventListener('online', this.handleOnline)
    window.removeEventListener('offline', this.handleOffline)

    this.doc.off('update', this.handleLocalUpdate)
    this.socket?.close()
    this.persistence?.destroy()
    this.awareness.destroy()
    this.doc.destroy()
  }
}
