/**
 * Справочник точек и времени в пути.
 *
 * Держим целиком в памяти: точек десятки, плеч сотни — это единицы килобайт,
 * зато таблица считает срок прибытия на месте, не спрашивая сервер на каждую
 * изменённую ячейку.
 */
import { create } from 'zustand'
import { api } from '@/api'
import type { Place, RouteLeg } from '@/types'

type RoutesState = {
  places: Place[]
  legs: RouteLeg[]
  loaded: boolean
  loading: boolean
  error: string
  load: (force?: boolean) => Promise<void>
}

/**
 * Приводит написание к сравнимому виду.
 *
 * В таблицах пишут вразнобой: «Ташкент», «ТАШКЕНТ», «ташкент  ». Справочник
 * хранит тот же ключ, поэтому сопоставление не зависит от того, как набрали.
 */
export function placeKey(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).join(' ')
}

export const useRoutes = create<RoutesState>((set, get) => ({
  places: [],
  legs: [],
  loaded: false,
  loading: false,
  error: '',

  async load(force = false) {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true, error: '' })
    try {
      const [places, legs] = await Promise.all([api.listPlaces(), api.listRouteLegs()])
      set({
        places: Array.isArray(places) ? places : [],
        legs: Array.isArray(legs) ? legs : [],
        loaded: true,
      })
    } catch {
      // Без справочника таблица просто не подставляет срок — работать можно.
      set({ error: 'Не удалось загрузить справочник точек' })
    } finally {
      set({ loading: false })
    }
  },
}))

/** Сколько часов от точки до точки. null — такого плеча в справочнике нет. */
export function hoursBetween(legs: RouteLeg[], from: string, to: string): number | null {
  const origin = placeKey(from)
  const destination = placeKey(to)
  if (!origin || !destination || origin === destination) return null

  const leg = legs.find(
    (item) => item.origin_key === origin && item.destination_key === destination,
  )
  if (!leg) return null

  const hours = Number(leg.hours)
  return Number.isFinite(hours) ? hours : null
}
