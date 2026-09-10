/**
 * Клиент REST API.
 *
 * Токен доступа живёт полчаса, поэтому при ответе 401 запрос повторяется один
 * раз — после обновления пары токенов. Параллельные запросы ждут одного общего
 * обновления: иначе десяток одновременных вызовов затеял бы десять обновлений,
 * и все, кроме первого, получили бы отозванный токен.
 */

const API_URL = import.meta.env.VITE_API_URL ?? '/api'

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

let refreshing: Promise<string | null> | null = null

async function refreshTokens(): Promise<string | null> {
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
          return null
        }
        const data = await response.json()
        tokens.set(data.access, data.refresh)
        return data.access as string
      })
      .catch(() => {
        tokens.clear()
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

export async function request<T = unknown>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, params, formData, retry = true } = options

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

  const response = await fetch(url.toString(), {
    method,
    headers,
    body: formData ?? (body !== undefined ? JSON.stringify(body) : undefined),
  })

  if (response.status === 401 && retry && tokens.refresh) {
    const renewed = await refreshTokens()
    if (renewed) return request<T>(path, { ...options, retry: false })
  }

  if (response.status === 204) return undefined as T

  const payload = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.detail ?? 'Не удалось выполнить запрос',
      payload.code ?? 'error',
      payload.fields,
    )
  }
  return payload as T
}
