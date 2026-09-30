import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/api'
import { AppLayout } from '@/components/AppLayout'
import type { AccountantDashboard, AccountantRow } from '@/types'

type CargoStatus = AccountantRow['status']

const STATUS: Record<CargoStatus, string> = { in_transit: 'В пути', delivered: 'Груз доставлен' }
const money = (value: string) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} $`

export function AccountantPage() {
  const [data, setData] = useState<AccountantDashboard | null>(null)
  const [status, setStatus] = useState<CargoStatus>('in_transit')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.accountantSummary()
      .then(setData)
      .catch(() => setError('Не удалось загрузить грузовые таблицы. Обновите страницу или войдите заново.'))
      .finally(() => setLoading(false))
  }, [])

  const rows = useMemo(() => data?.rows.filter((row) => row.status === status) ?? [], [data, status])
  const total = data?.totals[status]

  return (
    <AppLayout title="Бухгалтерия">
      <section className="mb-5 rounded-3xl bg-[#102d2b] px-5 py-6 text-white sm:px-8 sm:py-8">
        <p className="text-xs font-semibold uppercase tracking-[.2em] text-emerald-200">ALI trade · Контроль грузов</p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="text-2xl font-semibold sm:text-3xl">Грузы и расходы</h2><p className="mt-2 max-w-xl text-sm leading-6 text-white/75">Все доступные таблицы организации в режиме просмотра. Здесь собраны грузы, налог и транзит из грузовых листов.</p></div>
          <Link to="/documents" className="inline-flex min-h-11 w-fit items-center rounded-full bg-emerald-300 px-4 text-sm font-semibold text-[#102d2b]">Все таблицы <span className="ml-2" aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        {(['in_transit', 'delivered'] as const).map((key) => {
          const summary = data?.totals[key]
          return <button key={key} type="button" onClick={() => setStatus(key)} aria-pressed={status === key} className={`rounded-2xl border p-4 text-left transition sm:p-5 ${status === key ? 'border-accent bg-accent/5 ring-1 ring-accent' : 'border-hairline bg-surface hover:bg-surface-muted'}`}>
            <span className="text-sm text-ink-muted">{STATUS[key]}</span>
            <span className="mt-1 block text-3xl font-semibold tabular-nums text-ink">{loading ? '—' : summary?.count ?? 0}</span>
            <span className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted"><span>Налог <b className="font-semibold text-ink">{loading ? '—' : money(summary?.tax ?? '0')}</b></span><span>Транзит <b className="font-semibold text-ink">{loading ? '—' : money(summary?.transit ?? '0')}</b></span></span>
          </button>
        })}
      </div>

      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-4 py-4 sm:px-5">
          <div><h2 className="font-semibold text-ink">{STATUS[status]}</h2><p className="mt-1 text-xs text-ink-muted">{loading ? 'Загружаем таблицы…' : `${rows.length} грузов`}</p></div>
          <div className="flex gap-1 rounded-full bg-surface-muted p-1" role="group" aria-label="Фильтр грузов">
            {(['in_transit', 'delivered'] as const).map((key) => <button key={key} type="button" onClick={() => setStatus(key)} aria-pressed={status === key} className={`min-h-9 rounded-full px-3 text-xs font-medium sm:text-sm ${status === key ? 'bg-surface text-accent shadow-sm' : 'text-ink-muted'}`}>{STATUS[key]}</button>)}
          </div>
        </div>
        {error ? <p role="alert" className="p-5 text-sm text-red-700">{error}</p> : loading ? <div className="space-y-3 p-5"><div className="skeleton h-10"/><div className="skeleton h-10"/></div> : rows.length === 0 ? <div className="px-5 py-12 text-center"><p className="font-medium text-ink">Грузов пока нет</p><p className="mt-1 text-sm text-ink-muted">Проверьте грузовые таблицы или создайте журнал рейсов.</p><Link to="/templates" className="mt-4 inline-flex min-h-10 items-center rounded-full bg-accent px-4 text-sm font-medium text-white">Открыть шаблоны</Link></div> : <>
          <ul className="divide-y divide-hairline md:hidden">{rows.map((row, index) => <li key={`${row.document_id}-${row.sheet}-${index}`} className="p-4"><div className="flex items-start justify-between gap-3"><span className="min-w-0"><span className="block break-words font-medium text-ink">{row.cargo}</span><span className="mt-1 block text-xs text-ink-muted">{row.route || 'Маршрут не указан'}</span></span><span className="shrink-0 rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700">{STATUS[row.status]}</span></div><Link to={`/documents/${row.document_id}`} className="mt-3 block truncate text-xs text-accent">{row.document_title} · {row.sheet}</Link><div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-3 text-xs"><span className="text-ink-muted">Налог <b className="mt-1 block text-sm font-semibold text-ink">{money(row.tax)}</b></span><span className="text-ink-muted">Транзит <b className="mt-1 block text-sm font-semibold text-ink">{money(row.transit)}</b></span></div></li>)}</ul>
          <div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="bg-surface-muted text-left text-xs text-ink-muted"><tr><th className="px-5 py-3 font-medium">Груз</th><th className="px-5 py-3 font-medium">Маршрут</th><th className="px-5 py-3 font-medium">Таблица</th><th className="px-5 py-3 text-right font-medium">Налог</th><th className="px-5 py-3 text-right font-medium">Транзит</th></tr></thead><tbody className="divide-y divide-hairline">{rows.map((row, index) => <tr key={`${row.document_id}-${row.sheet}-${index}`}><td className="px-5 py-3 font-medium text-ink">{row.cargo}</td><td className="px-5 py-3 text-ink-muted">{row.route || '—'}</td><td className="px-5 py-3"><Link to={`/documents/${row.document_id}`} className="text-accent hover:underline">{row.document_title} · {row.sheet}</Link></td><td className="px-5 py-3 text-right tabular-nums text-ink">{money(row.tax)}</td><td className="px-5 py-3 text-right tabular-nums text-ink">{money(row.transit)}</td></tr>)}</tbody></table></div>
        </>}
        {total && rows.length > 0 && <div className="flex flex-wrap justify-end gap-x-6 gap-y-2 border-t border-hairline bg-surface-muted px-4 py-3 text-xs text-ink-muted sm:px-5"><span>Итого налог: <b className="text-ink">{money(total.tax)}</b></span><span>Итого транзит: <b className="text-ink">{money(total.transit)}</b></span></div>}
      </section>
    </AppLayout>
  )
}
