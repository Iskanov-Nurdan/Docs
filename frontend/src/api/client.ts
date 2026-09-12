/**
 * Клиент REST API.
 *
 * Токен доступа живёт полчаса, поэтому при ответе 401 запрос повторяется один
 * раз — после обновления пары токенов. Параллельные запросы ждут одного общего
 * обновления: иначе десяток одновременных вызовов затеял бы десять обновлений,
 * и все, кроме первого, получили бы отозванный токен.
 */

// Пустое значение переменной значит «тот же адрес, что и страница»:
// в разработке и в бою запросы идут через тот же nginx, и указывать порт
// отдельно не нужно. ?? здесь не годится — пустая строка им не отсекается.
const API_URL = import.meta.env.VITE_API_URL || '/api'

const ACCESS_KEY = 'docs.access'
const REFRESH_KEY = 'docs.refresh'

export class ApiError extends Error {
  status: number
  code: string
  fields?: Record<string, string[]>

  constructor(status: number, detail: string, code = 'error', fields?: Record<string, string[]>) {
    super(detail)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

export const tokens = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set(access: string, refresh?: string) {
    localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

/**
 * Кого позвать, когда сессия окончательно закончилась.
 *
 * Раньше протухший refresh просто стирал токены, а приложение об этом не
 * узнавало: пользователь оставался внутри, каждый следующий запрос отвечал
 * 401, и выйти на форму входа было нечему.
 */
type Listener = () => void
const unauthorizedListeners = new Set<Listener>()

export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener)
  return () => unauthorizedListeners.delete(listener)
}

function announceUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener()
}

let refreshing: Promise<string | null> | null = null

export async function refreshTokens(): Promise<string | null> {
  const refresh = tokens.refresh
  if (!refresh) return null

  // Общий промис на все параллельные запросы.
  if (!refreshing) {
    refreshing = fetch(`${API_URL}/auth/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then(async (response) => {
        if (!response.ok) {
          tokens.clear()
          announceUnauthorized()
          return null
        }
        const data = await response.json()
        tokens.set(data.access, data.refresh)
        return data.access as string
      })
      .catch(() => {
        tokens.clear()
        announceUnauthorized()
        return null
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

type RequestOptions = {
  method?: string
  body?: unknown
  params?: Record<string, string | number | boolean | undefined | null>
  formData?: FormData
  retry?: boolean
}

/** Тело ответа как есть: null, если оно пустое или не разбирается. */
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * Описание ошибки из тела — всегда объектом.
 *
 * Объект обязателен: тело «null» при ошибке 500 роняло клиент на payload.detail,
 * и наружу летел TypeError вместо ApiError — а страницы разбирают ошибки через
 * instanceof.
 *
 * Приводить к объекту можно только ошибки. Успешный ответ проходит мимо:
 * половина запросов возвращает список — папки, шаблоны, выдачу поиска, — и
 * такое приведение делало из списка пустой объект. Страница падала потом,
 * на folders.forEach, далеко от места настоящей ошибки.
 */
function errorPayload(parsed: unknown): Record<string, unknown> {
  // Ошибка без привязки к полю приходит списком: ["Такой адрес уже занят"].
  if (Array.isArray(parsed)) {
    const text = parsed.filter((item) => typeof item === 'string').join(' ')
    return text ? { detail: text } : {}
  }
  if (!parsed || typeof parsed !== 'object') return {}
  return parsed as Record<string, unknown>
}

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, formData, retry = true } = options

  // Идентификатор из адресной строки попадает в путь без обработки, а new URL
  // сворачивает «..». Без этой проверки ссылка вида
  // /documents/..%2F..%2Fadmin%2Fusers заставляла клиент отправить заголовок
  // с токеном на произвольный путь того же узла.
  if (!path.startsWith('/') || path.split('/').includes('..')) {
    throw new ApiError(400, 'Неверный адрес запроса', 'bad_path')
  }

  const url = new URL(`${API_URL}${path}`, window.location.origin)
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value))
      }
    })
  }

  const headers: Record<string, string> = {}
  const access = tokens.access
  if (access) headers.Authorization = `Bearer ${access}`
  if (!formData && body !== undefined) headers['Content-Type'] = 'application/json'

  let response: Response
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
    })
  } catch {
    // Сеть отвалилась. Наружу всё равно ApiError: иначе обработчики страниц
    // проходили мимо и человек видел белый экран вместо «нет связи».
    throw new ApiError(0, 'Нет связи с сервером', 'network')
  }

  if (response.status === 401 && retry && tokens.refresh) {
    const renewed = await refreshTokens()
    if (renewed) return request<T>(path, { ...options, retry: false })
  }

  // Отказ, который обновлением токена не лечится: сессия закончилась.
  if (response.status === 401 && !tokens.refresh) announceUnauthorized()

  if (response.status === 204) return undefined as T

  const parsed = await readBody(response)

  if (!response.ok) {
    const payload = errorPayload(parsed)
    throw new ApiError(
      response.status,
      typeof payload.detail === 'string' ? payload.detail : 'Не удалось выполнить запрос',
      typeof payload.code === 'string' ? payload.code : 'error',
      payload.fields as Record<string, string[]> | undefined,
    )
  }
  return parsed as T
}
