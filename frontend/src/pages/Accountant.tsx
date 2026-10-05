import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { AppLayout } from '@/components/AppLayout'
import type { AccountantDashboard, AccountantRow } from '@/types'

type CargoStatus = AccountantRow['status']
type Totals = { count: number; tax: number; transit: number }
type DocumentTotals = { id: string; title: string; in_transit: Totals; delivered: Totals; tax: number; transit: number }

const STATUSES = ['in_transit', 'delivered'] as const
const STATUS: Record<CargoStatus, string> = { in_transit: 'В пути', delivered: 'Груз доставлен' }
const money = (value: string | number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} $`
const emptyTotals = (): Totals => ({ count: 0, tax: 0, transit: 0 })

/** Суммы по набору строк, разложенные по статусу груза. */
function totalsByStatus(rows: AccountantRow[]): Record<CargoStatus, Totals> {
  const result = { in_transit: emptyTotals(), delivered: emptyTotals() }
  for (const row of rows) {
    const group = result[row.status]
    group.count += 1
    group.tax += Number(row.tax) || 0
    group.transit += Number(row.transit) || 0
  }
  return result
}

export function AccountantPage() {
  const [data, setData] = useState<AccountantDashboard | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<CargoStatus>('in_transit')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.accountantSummary()
      .then(setData)
      .catch(() => setError('Не удалось загрузить грузовые таблицы. Обновите страницу или войдите заново.'))
      .finally(() => setLoading(false))
  }, [])

  const documents = useMemo<DocumentTotals[]>(() => {
    const byId = new Map<string, AccountantRow[]>()
    for (const row of data?.rows ?? []) {
      byId.set(row.document_id, [...(byId.get(row.document_id) ?? []), row])
    }
    // Список — все таблицы, в том числе те, где грузовых колонок нет.
    return (data?.documents ?? []).map(({ id, title }) => {
      const totals = totalsByStatus(byId.get(id) ?? [])
      return {
        id,
        title: title || 'Без названия',
        ...totals,
        tax: totals.in_transit.tax + totals.delivered.tax,
        transit: totals.in_transit.transit + totals.delivered.transit,
      }
    })
  }, [data])

  const selected = documents.find((item) => item.id === selectedId) ?? null
  const documentRows = useMemo(
    () => data?.rows.filter((row) => row.document_id === selectedId) ?? [],
    [data, selectedId],
  )
  const totals = useMemo(() => totalsByStatus(documentRows), [documentRows])
  const rows = documentRows.filter((row) => row.status === status)
  const total = totals[status]

  const open = (id: string) => {
    setSelectedId(id)
    setStatus('in_transit')
  }

  return (
    <AppLayout title="Бухгалтерия">
      <section className="mb-5 rounded-3xl bg-[#102d2b] px-5 py-6 text-white sm:px-8 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-emerald-200">ALI trade · Контроль грузов</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">Грузы и расходы</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">
              Все доступные таблицы организации в режиме просмотра. Выберите таблицу, чтобы увидеть её грузы, налог и транзит.
            </p>
          </div>
          <Link to="/documents" className="inline-flex min-h-11 w-fit items-center rounded-full bg-emerald-300 px-4 text-sm font-semibold text-[#102d2b]">Все таблицы <span className="ml-2" aria-hidden="true">↗</span></Link>
        </div>
      </section>

      {error ? (
        <p role="alert" className="rounded-2xl border border-hairline bg-surface p-5 text-sm text-red-700">{error}</p>
      ) : loading ? (
        <div className="space-y-3 rounded-2xl border border-hairline bg-surface p-5"><div className="skeleton h-14" /><div className="skeleton h-14" /><div className="skeleton h-14" /></div>
      ) : !selected ? (
        <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
          <div className="border-b border-hairline px-4 py-4 sm:px-5">
            <h2 className="font-semibold text-ink">Таблицы</h2>
            <p className="mt-1 text-xs text-ink-muted">Всего таблиц: {documents.length}</p>
          </div>
          {documents.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="font-medium text-ink">Таблиц пока нет</p>
              <p className="mt-1 text-sm text-ink-muted">Создайте журнал рейсов — он появится здесь.</p>
              <Link to="/templates" className="mt-4 inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-sm font-medium text-white">Открыть шаблоны</Link>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {documents.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => open(item.id)} className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <span className="min-w-0">
                      <span className="block break-words font-medium text-ink">{item.title}</span>
                      <span className="mt-1 block text-xs text-ink-muted">
                        {item.in_transit.count + item.delivered.count === 0
                          ? 'Грузов не найдено'
                          : `В пути: ${item.in_transit.count} · Доставлено: ${item.delivered.count}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-x-6 text-xs text-ink-muted">
                      <span>Налог <b className="block text-sm font-semibold tabular-nums text-ink">{money(item.tax)}</b></span>
                      <span>Транзит <b className="block text-sm font-semibold tabular-nums text-ink">{money(item.transit)}</b></span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={() => setSelectedId(null)} className="inline-flex min-h-10 items-center rounded-full border border-hairline px-4 text-sm text-ink hover:bg-surface-muted">← Все таблицы</button>
            <Link to={`/documents/${selected.id}`} className="text-sm text-accent hover:underline">Открыть таблицу ↗</Link>
          </div>
          <h2 className="mb-3 break-words text-xl font-semibold text-ink">{selected.title}</h2>

          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            {STATUSES.map((key) => (
              <button key={key} type="button" onClick={() => setStatus(key)} aria-pressed={status === key} className={`rounded-2xl border p-4 text-left transition sm:p-5 ${status === key ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-hairline bg-surface hover:bg-surface-muted'}`}>
                <span className="text-sm text-ink-muted">{STATUS[key]}</span>
                <span className="mt-1 block text-3xl font-semibold tabular-nums text-ink">{totals[key].count}</span>
                <span className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                  <span>Налог <b className="font-semibold text-ink">{money(totals[key].tax)}</b></span>
                  <span>Транзит <b className="font-semibold text-ink">{money(totals[key].transit)}</b></span>
                </span>
              </button>
            ))}
          </div>

          <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
            <div className="border-b border-hairline px-4 py-4 sm:px-5">
              <h3 className="font-semibold text-ink">{STATUS[status]}</h3>
              <p className="mt-1 text-xs text-ink-muted">{rows.length} грузов</p>
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-ink-muted">
                {documentRows.length === 0
                  ? 'В этой таблице нет грузового журнала: не нашлось колонок «Груз», «Налог», «Транзит».'
                  : `В этой таблице нет грузов со статусом «${STATUS[status]}».`}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-hairline md:hidden">
                  {rows.map((row, index) => (
                    <li key={`${row.sheet}-${index}`} className="p-4">
                      <span className="block break-words font-medium text-ink">{row.cargo}</span>
                      <span className="mt-1 block text-xs text-ink-muted">{row.route || 'Маршрут не указан'} · {row.sheet}</span>
                      <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-3 text-xs">
                        <span className="text-ink-muted">Налог <b className="mt-1 block text-sm font-semibold text-ink">{money(row.tax)}</b></span>
                        <span className="text-ink-muted">Транзит <b className="mt-1 block text-sm font-semibold text-ink">{money(row.transit)}</b></span>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-muted text-left text-xs text-ink-muted">
                      <tr>
                        <th className="px-5 py-3 font-medium">Груз</th>
                        <th className="px-5 py-3 font-medium">Маршрут</th>
                        <th className="px-5 py-3 font-medium">Лист</th>
                        <th className="px-5 py-3 text-right font-medium">Налог</th>
                        <th className="px-5 py-3 text-right font-medium">Транзит</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {rows.map((row, index) => (
                        <tr key={`${row.sheet}-${index}`}>
                          <td className="px-5 py-3 font-medium text-ink">{row.cargo}</td>
                          <td className="px-5 py-3 text-ink-muted">{row.route || '—'}</td>
                          <td className="px-5 py-3 text-ink-muted">{row.sheet}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-ink">{money(row.tax)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-ink">{money(row.transit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 border-t border-hairline bg-surface-muted px-4 py-3 text-xs text-ink-muted sm:px-5">
                  <span>Итого налог: <b className="text-ink">{money(total.tax)}</b></span>
                  <span>Итого транзит: <b className="text-ink">{money(total.transit)}</b></span>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </AppLayout>
  )
}
