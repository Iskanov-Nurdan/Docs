/**
 * Тема оформления.
 *
 * Выбор хранится и на сервере (в профиле), и локально: класс на <html> нужно
 * поставить до первого запроса к серверу, иначе страница успевает мигнуть
 * светлой темой у тех, кто выбрал тёмную.
 *
 * Почти весь интерфейс переключается одними классами Tailwind, но не весь:
 * заливку ячеек таблица считает в JavaScript и красит через style. Такому
 * коду нужна подписка, поэтому смена темы объявляется событием.
 */
import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'docs.theme'
const THEME_EVENT = 'docs:theme'

const media = window.matchMedia('(prefers-color-scheme: dark)')

/**
 * Localstorage может быть недоступен — приватное окно, запрет на данные сайта.
 * Тема в этом случае просто не переживёт перезагрузку, но падать приложение
 * из-за настройки оформления не должно.
 */
function readStored(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : null
  } catch {
    return null
  }
}

function writeStored(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // Ничего: выбор доживёт до конца сессии в классе на <html>.
  }
}

export function readTheme(): Theme {
  return readStored() ?? 'system'
}

export function applyTheme(theme: Theme): void {
  writeStored(theme)
  const dark = theme === 'dark' || (theme === 'system' && media.matches)

  const root = document.documentElement
  if (root.classList.contains('dark') === dark) return

  root.classList.toggle('dark', dark)
  window.dispatchEvent(new Event(THEME_EVENT))
}

/** Пока выбрана системная тема, интерфейс следует за настройкой ОС. */
export function watchSystemTheme(): () => void {
  const handler = () => {
    if (readTheme() === 'system') applyTheme('system')
  }
  media.addEventListener('change', handler)
  return () => media.removeEventListener('change', handler)
}

export function isDarkTheme(): boolean {
  return document.documentElement.classList.contains('dark')
}

function subscribeTheme(listener: () => void): () => void {
  window.addEventListener(THEME_EVENT, listener)
  return () => window.removeEventListener(THEME_EVENT, listener)
}

/**
 * Тёмная ли сейчас тема — для того, что красится не классами, а вычисленным
 * цветом. Без этой подписки таблица читала класс на <html> прямо в отрисовке
 * и после смены темы оставалась в прежней палитре до первой чужой правки.
 */
export function useIsDarkTheme(): boolean {
  return useSyncExternalStore(subscribeTheme, isDarkTheme, () => false)
}
