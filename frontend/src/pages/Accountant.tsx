import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { AppLayout } from '@/components/AppLayout'
import type { AccountantAmounts, AccountantDashboard, AccountantRow, AccountantStatus } from '@/types'

type Field = keyof AccountantAmounts
type Totals = Record<Field, number> & { count: number }
type DocumentTotals = { id: string; title: string; byStatus: Record<AccountantStatus, Totals>; all: Totals }

const STATUSES: AccountantStatus[] = ['in_transit', 'delivered', 'other']
const STATUS: Record<AccountantStatus, string> = {
  in_transit: 'В пути',
  delivered: 'Груз доставлен',
  other: 'Без статуса',
}
const FIELDS: { key: Field; label: string }[] = [
  { key: 'income', label: 'Доход' },
  { key: 'expense', label: 'Расход' },
  { key: 'profit', label: 'Прибыль' },
  { key: 'loss', label: 'Ущерб' },
  { key: 'tax', label: 'Налог' },
  { key: 'transit', label: 'Транзит' },
]
// Налог и транзит показываем всегда — это основа грузового журнала. Остальное
// только там, где в таблице действительно есть такие деньги, иначе в строке
// лежал бы ряд нулей.
const ALWAYS: Field[] = ['tax', 'transit']

const money = (value: string | number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} $`
const emptyTotals = (): Totals => ({ count: 0, tax: 0, transit: 0, income: 0, expense: 0, profit: 0, loss: 0 })

function sum(rows: AccountantRow[]): Totals {
  const result = emptyTotals()
  for (const row of rows) {
    result.count += 1
    for (const { key } of FIELDS) result[key] += Number(row[key]) || 0
  }
  return result
}

const byStatus = (rows: AccountantRow[]) =>
  Object.fromEntries(STATUSES.map((status) => [status, sum(rows.filter((row) => row.status === status))])) as Record<AccountantStatus, Totals>

/** Поля, у которых в этом наборе есть хоть одна ненулевая сумма. */
const usedFields = (rows: AccountantRow[]) =>
  FIELDS.filter(({ key }) => ALWAYS.includes(key) || rows.some((row) => Number(row[key]) !== 0))

export function AccountantPage() {
  const [data, setData] = useState<AccountantDashboard | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<AccountantStatus>('in_transit')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.accountantSummary()
      .then(setData)
      .catch(() => setError('Не удалось загрузить грузовые таблицы. Обновите страницу или войдите заново.'))
      .finally(() => setLoading(false))
  }, [])

  const documents = useMemo<DocumentTotals[]>(() => {
    const grouped = new Map<string, AccountantRow[]>()
    for (const row of data?.rows ?? []) {
      grouped.set(row.document_id, [...(grouped.get(row.document_id) ?? []), row])
    }
    // Список — все таблицы, в том числе те, где грузовых колонок нет.
    return (data?.documents ?? []).map(({ id, title }) => {
      const rows = grouped.get(id) ?? []
      return { id, title: title || 'Без названия', byStatus: byStatus(rows), all: sum(rows) }
    })
  }, [data])

  const selected = documents.find((item) => item.id === selectedId) ?? null
  const documentRows = useMemo(
    () => data?.rows.filter((row) => row.document_id === selectedId) ?? [],
    [data, selectedId],
  )
  const rows = documentRows.filter((row) => row.status === status)
  const fields = useMemo(() => usedFields(documentRows), [documentRows])
  // «Без статуса» показываем, только когда такие строки есть.
  const statuses = STATUSES.filter((key) => key !== 'other' || (selected?.byStatus.other.count ?? 0) > 0)

  const open = (id: string) => {
    const item = documents.find((candidate) => candidate.id === id)
    // Открываем сразу то, где что-то есть: пустая вкладка выглядела бы поломкой.
    setStatus(STATUSES.find((key) => (item?.byStatus[key].count ?? 0) > 0) ?? 'in_transit')
    setSelectedId(id)
  }

  return (
    <AppLayout title="Бухгалтерия">
      <section className="mb-5 rounded-3xl bg-[#102d2b] px-5 py-6 text-white sm:px-8 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-emerald-200">ALI trade · Контроль грузов</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold sm:text-3xl">Грузы и расходы</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/75">
              Все таблицы организации в режиме просмотра. Выберите таблицу, чтобы увидеть доход, расход, прибыль, налог и транзит по каждому рейсу.
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
              {documents.map((item) => {
                const shown = FIELDS.filter(({ key }) => ALWAYS.includes(key) || item.all[key] !== 0)
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => open(item.id)} className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-surface-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
                      <span className="min-w-0">
                        <span className="block break-words font-medium text-ink">{item.title}</span>
                        <span className="mt-1 block text-xs text-ink-muted">
                          {item.all.count === 0
                            ? 'Денег и грузов не найдено'
                            : `Строк: ${item.all.count} · В пути: ${item.byStatus.in_transit.count} · Доставлено: ${item.byStatus.delivered.count}`}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap gap-x-6 gap-y-2 text-xs text-ink-muted">
                        {shown.map(({ key, label }) => (
                          <span key={key}>{label} <b className="block text-sm font-semibold tabular-nums text-ink">{money(item.all[key])}</b></span>
                        ))}
                      </span>
                    </button>
                  </li>
                )
              })}
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

          <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {statuses.map((key) => (
              <button key={key} type="button" onClick={() => setStatus(key)} aria-pressed={status === key} className={`rounded-2xl border p-4 text-left transition sm:p-5 ${status === key ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-hairline bg-surface hover:bg-surface-muted'}`}>
                <span className="text-sm text-ink-muted">{STATUS[key]}</span>
                <span className="mt-1 block text-3xl font-semibold tabular-nums text-ink">{selected.byStatus[key].count}</span>
                <span className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                  {fields.map(({ key: field, label }) => (
                    <span key={field}>{label} <b className="font-semibold text-ink">{money(selected.byStatus[key][field])}</b></span>
                  ))}
                </span>
              </button>
            ))}
          </div>

          <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
            <div className="border-b border-hairline px-4 py-4 sm:px-5">
              <h3 className="font-semibold text-ink">{STATUS[status]}</h3>
              <p className="mt-1 text-xs text-ink-muted">Строк: {rows.length}</p>
            </div>
            {rows.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-ink-muted">
                {documentRows.length === 0
                  ? 'В этой таблице не нашлось колонок с деньгами и грузом (доход, расход, прибыль, налог, транзит).'
                  : `В этой таблице нет строк со статусом «${STATUS[status]}».`}
              </p>
            ) : (
              <>
                <ul className="divide-y divide-hairline md:hidden">
                  {rows.map((row, index) => (
                    <li key={`${row.sheet}-${index}`} className="p-4">
                      <span className="block break-words font-medium text-ink">{row.cargo}</span>
                      <span className="mt-1 block text-xs text-ink-muted">{row.route || 'Маршрут не указан'} · {row.sheet}</span>
                      <div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-3 text-xs">
                        {fields.map(({ key, label }) => (
                          <span key={key} className="text-ink-muted">{label} <b className="mt-1 block text-sm font-semibold text-ink">{money(row[key])}</b></span>
                        ))}
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
                        {fields.map(({ key, label }) => <th key={key} className="px-5 py-3 text-right font-medium">{label}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {rows.map((row, index) => (
                        <tr key={`${row.sheet}-${index}`}>
                          <td className="px-5 py-3 font-medium text-ink">{row.cargo}</td>
                          <td className="px-5 py-3 text-ink-muted">{row.route || '—'}</td>
                          <td className="px-5 py-3 text-ink-muted">{row.sheet}</td>
                          {fields.map(({ key }) => <td key={key} className="px-5 py-3 text-right tabular-nums text-ink">{money(row[key])}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 border-t border-hairline bg-surface-muted px-4 py-3 text-xs text-ink-muted sm:px-5">
                  {fields.map(({ key, label }) => (
                    <span key={key}>Итого {label.toLowerCase()}: <b className="text-ink">{money(selected.byStatus[status][key])}</b></span>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </AppLayout>
  )
}
