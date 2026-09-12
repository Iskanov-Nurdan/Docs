/** Форматирование дат в интерфейсе. */

const FULL = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' })
const TIME = new Intl.DateTimeFormat('ru', { timeStyle: 'short' })

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  return FULL.format(new Date(value))
}

/**
 * Короткая подпись для ленты обсуждения: у свежих записей время без даты,
 * у остальных — полная дата. В переписке важнее «когда», а не «какого числа».
 */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—'

  const date = new Date(value)
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000)

  if (minutes < 1) return 'только что'
  if (minutes < 60) return `${minutes} мин назад`

  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  if (date >= startOfToday) return `сегодня, ${TIME.format(date)}`

  return FULL.format(date)
}
