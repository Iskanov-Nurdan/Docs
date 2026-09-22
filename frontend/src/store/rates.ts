/**
 * Курс доллара к сому.
 *
 * Один на всё приложение: курс общий для конторы, и запрашивать его в каждой
 * открытой таблице незачем. Обновляем при открытии редактора — Нацбанк меняет
 * курс раз в сутки, чаще спрашивать нечего.
 */
import { create } from 'zustand'
import { api } from '@/api'
import type { UsdRate } from '@/types'

type RatesState = {
  usd: UsdRate | null
  loading: boolean
  load: (force?: boolean) => Promise<void>
}

export const useRates = create<RatesState>((set, get) => ({
  usd: null,
  loading: false,

  async load(force = false) {
    if (get().loading || (get().usd && !force)) return
    set({ loading: true })
    try {
      set({ usd: await api.usdRate() })
    } catch {
      // Без курса таблица просто не пересчитывает сумму и говорит об этом
      // в самой ячейке — отдельное сообщение об ошибке здесь не нужно.
      set({ usd: { rate: null, source: 'unavailable', date: null } })
    } finally {
      set({ loading: false })
    }
  },
}))
