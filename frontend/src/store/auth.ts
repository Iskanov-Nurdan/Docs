/** Состояние текущего пользователя. */
import { create } from 'zustand'
import { api, tokens } from '@/api'
import type { User } from '@/types'

type AuthState = {
  user: User | null
  loading: boolean
  initialized: boolean
  login: (email: string, password: string) => Promise<void>
  register: (data: { email: string; password: string; first_name?: string; last_name?: string }) => Promise<void>
  logout: () => Promise<void>
  restore: () => Promise<void>
  patchUser: (patch: Partial<User>) => void
}

export const useAuth = create<AuthState>((set) => ({
  user: null,
  loading: false,
  initialized: false,

  async login(email, password) {
    set({ loading: true })
    try {
      const data = await api.login({ email, password })
      tokens.set(data.access, data.refresh)
      set({ user: data.user, initialized: true })
    } finally {
      set({ loading: false })
    }
  },

  async register(payload) {
    set({ loading: true })
    try {
      const data = await api.register(payload)
      tokens.set(data.access, data.refresh)
      set({ user: data.user, initialized: true })
    } finally {
      set({ loading: false })
    }
  },

  async logout() {
    try {
      await api.logout()
    } catch {
      // Даже если сервер не ответил, из приложения выходим:
      // держать человека внутри против его воли нельзя.
    }
    tokens.clear()
    set({ user: null })
  },

  /** Восстановление сессии при загрузке страницы. */
  async restore() {
    if (!tokens.access && !tokens.refresh) {
      set({ initialized: true })
      return
    }
    set({ loading: true })
    try {
      const user = await api.me()
      set({ user, initialized: true })
    } catch {
      tokens.clear()
      set({ user: null, initialized: true })
    } finally {
      set({ loading: false })
    }
  },

  patchUser(patch) {
    set((state) => (state.user ? { user: { ...state.user, ...patch } } : state))
  },
}))
