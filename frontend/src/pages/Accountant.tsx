import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppLayout } from '@/components/AppLayout'
import { api } from '@/api'
import type { DocumentSummary } from '@/types'

const date = (value: string | null) => value
  ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : 'Пока без изменений'

export function AccountantPage() {
  const [documents, setDocuments] = useState<DocumentSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.listDocuments({ scope: 'active', ordering: '-last_edited_at', page_size: 6 })
      .then((result) => { setDocuments(result.results); setTotal(result.count) })
      .catch(() => setError('Не удалось загрузить рабочие документы'))
      .finally(() => setLoading(false))
  }, [])

  return (
    <AppLayout title="Рабочий стол бухгалтера">
      <section className="relative isolate mb-6 overflow-hidden rounded-[28px] bg-[#102d2b] px-6 py-8 text-white shadow-lg sm:px-9 sm:py-10">
        <div className="pointer-events-none absolute -right-12 -top-24 -z-10 h-72 w-72 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-[-7rem] right-1/3 -z-10 h-56 w-56 rounded-full bg-teal-300/10 blur-3xl" />
        <p className="mb-3 text-xs font-semibold uppercase tracking-[.22em] text-emerald-200">ALI trade · Финансы</p>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-xl">
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Всё по цифрам.<br className="hidden sm:block" /> Спокойно и под контролем.</h2>
            <p className="mt-3 max-w-lg text-sm leading-6 text-emerald-50/75">Ваше пространство для ежедневной работы с таблицами и финансовыми документами.</p>
          </div>
          <Link to="/documents" className="inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-emerald-300 px-5 text-sm font-semibold text-[#102d2b] transition hover:bg-emerald-200 focus:outline-none focus:ring-2 focus:ring-white">Открыть документы <span className="ml-2" aria-hidden="true">↗</span></Link>
        </div>
      </section>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <article className="rounded-2xl border border-hairline bg-surface p-5"><p className="text-sm text-ink-muted">Активные документы</p><p className="mt-2 text-3xl font-semibold tabular-nums text-ink">{loading ? '—' : total}</p><p className="mt-1 text-xs text-ink-muted">доступны в вашем рабочем пространстве</p></article>
        <article className="rounded-2xl border border-hairline bg-surface p-5"><p className="text-sm text-ink-muted">Быстрый доступ</p><Link to="/starred" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-accent"><span className="text-amber-500" aria-hidden="true">★</span> Избранные таблицы <span aria-hidden="true">→</span></Link><p className="mt-2 text-xs text-ink-muted">Закрепите часто используемые документы</p></article>
        <article className="rounded-2xl border border-hairline bg-surface p-5"><p className="text-sm text-ink-muted">Совместная работа</p><Link to="/shared" className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-accent">Документы коллег <span aria-hidden="true">→</span></Link><p className="mt-2 text-xs text-ink-muted">Таблицы, к которым вам открыли доступ</p></article>
      </div>

      <section className="overflow-hidden rounded-2xl border border-hairline bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-4">
          <div><h2 className="font-semibold text-ink">Недавно открывали</h2><p className="mt-0.5 text-xs text-ink-muted">Ваши последние рабочие таблицы</p></div>
          <Link to="/documents" className="shrink-0 text-sm font-medium text-accent hover:underline">Все документы</Link>
        </div>
        {error ? <p role="alert" className="p-5 text-sm text-red-700">{error}</p> : loading ? <div className="space-y-3 p-5" aria-label="Загрузка"><div className="skeleton h-10"/><div className="skeleton h-10"/><div className="skeleton h-10"/></div> : documents.length ? <ul className="divide-y divide-hairline">{documents.map((doc) => <li key={doc.id}><Link to={`/documents/${doc.id}`} className="flex min-h-16 items-center gap-3 px-5 py-3 transition hover:bg-surface-muted"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700" aria-hidden="true">▦</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink">{doc.title}</span><span className="mt-1 block text-xs text-ink-muted">Изменено {date(doc.last_edited_at)}</span></span><span aria-hidden="true" className="text-ink-muted">→</span></Link></li>)}</ul> : <div className="px-5 py-10 text-center"><p className="font-medium text-ink">Начните с первой таблицы</p><p className="mt-1 text-sm text-ink-muted">Создайте или откройте документ, чтобы он появился здесь.</p><Link to="/documents" className="mt-4 inline-flex rounded-full bg-accent px-4 py-2 text-sm font-medium text-white">Перейти к документам</Link></div>}
      </section>
    </AppLayout>
  )
}
