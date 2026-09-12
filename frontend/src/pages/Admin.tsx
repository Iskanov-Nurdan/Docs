/**
 * Администрирование: люди и сводка по системе.
 *
 * Страницу видит администратор, но раздавать права может только главный
 * админ — у остальных выбор уровня заблокирован. Проверяет это сервер;
 * здесь блокировка нужна, чтобы человек не тыкал в кнопку, которая ему
 * всё равно откажет.
 */
import { useCallback, useEffect, useState } from 'react'
import { AppLayout } from '@/components/AppLayout'
import { Select } from '@/components/Select'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { NewUserDialog } from '@/components/NewUserDialog'
import { PlusIcon, SearchIcon, ShieldIcon, UserBlockIcon } from '@/components/icons'
import { ApiError, api } from '@/api'
import { useAuth } from '@/store/auth'
import { formatDateTime } from '@/utils/date'
import type { AdminSummary, AdminUser } from '@/types'

const ROLES = [
  { value: 'member', label: 'Пользователь', hint: 'Работает со своими таблицами' },
  { value: 'admin', label: 'Администратор', hint: 'Видит людей и закрывает доступ' },
]

const ROLE_LABELS: Record<AdminUser['role'], string> = {
  owner: 'Главный админ',
  admin: 'Администратор',
  member: 'Пользователь',
}

export function AdminPage() {
  const { user } = useAuth()
  const [users, setUsers] = useState<AdminUser[]>([])
  const [summary, setSummary] = useState<AdminSummary | null>(null)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [blocking, setBlocking] = useState<AdminUser | null>(null)
  const [creating, setCreating] = useState(false)

  const isSuperuser = user?.is_superuser === true

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [people, totals] = await Promise.all([
        api.adminUsers({ q: query || undefined }),
        api.adminSummary(),
      ])
      setUsers(people.results)
      setSummary(totals)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [query])

  // Поиск с задержкой: список людей запрашивается не на каждую букву.
  useEffect(() => {
    const timer = window.setTimeout(load, query ? 300 : 0)
    return () => window.clearTimeout(timer)
  }, [load, query])

  const apply = async (target: AdminUser, patch: { role?: 'admin' | 'member'; is_active?: boolean }) => {
    setError('')
    setNotice('')
    try {
      const updated = await api.updateAdminUser(target.id, patch)
      setUsers((prev) => prev.map((item) => (item.id === updated.id ? updated : item)))
      setNotice(
        patch.role
          ? `${updated.display_name}: ${ROLE_LABELS[updated.role].toLowerCase()}`
          : `${updated.display_name}: доступ ${updated.is_active ? 'открыт' : 'закрыт'}`,
      )
      // Счётчики в сводке изменились вместе с человеком.
      setSummary(await api.adminSummary())
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Действие не удалось')
    }
  }

  const cards: { label: string; value: number }[] = summary
    ? [
        { label: 'Пользователей', value: summary.users },
        { label: 'С открытым доступом', value: summary.active_users },
        { label: 'Администраторов', value: summary.admins },
        { label: 'Таблиц', value: summary.documents },
        { label: 'В корзине', value: summary.trashed },
      ]
    : []

  return (
    <AppLayout title="Администрирование">
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {loading && !summary
          ? Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="rounded-2xl border border-hairline bg-surface p-4">
                <div className="skeleton mb-2 h-7 w-16" />
                <div className="skeleton h-3 w-24" />
              </div>
            ))
          : cards.map((card) => (
              <div
                key={card.label}
                className="animate-rise rounded-2xl border border-hairline bg-surface p-4"
              >
                <p className="text-2xl font-semibold tabular-nums text-ink">{card.value}</p>
                <p className="mt-0.5 text-xs text-ink-muted">{card.label}</p>
              </div>
            ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
            <SearchIcon size={16} />
          </span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Почта или имя"
            aria-label="Поиск людей"
            className="w-full rounded-full border border-hairline bg-surface py-2 pl-10 pr-4 text-sm outline-none focus:border-accent"
          />
        </div>

        {!isSuperuser && (
          <p className="text-xs text-ink-muted">
            Назначать администраторов может только главный админ
          </p>
        )}

        <button
          type="button"
          onClick={() => setCreating(true)}
          className="ml-auto flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <PlusIcon size={16} />
          Завести пользователя
        </button>
      </div>

      {error && (
        <p role="alert" className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-3 rounded-xl bg-surface px-3 py-2 text-sm text-ink-muted">
          {notice}
        </p>
      )}

      {loading && users.length === 0 && (
        <div className="divide-y divide-hairline rounded-2xl border border-hairline bg-surface">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 px-4 py-3">
              <div className="skeleton h-8 w-8 rounded-full" />
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton hidden h-3 w-32 sm:block" />
            </div>
          ))}
        </div>
      )}

      {!loading && users.length === 0 && (
        <p className="py-16 text-center text-sm text-ink-muted">Никого не нашли</p>
      )}

      {users.length > 0 && (
        <div className="animate-rise overflow-x-auto rounded-2xl border border-hairline bg-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline bg-surface-muted text-left text-xs uppercase tracking-wide text-ink-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  Человек
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  Таблиц
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium lg:table-cell">
                  Последний вход
                </th>
                <th scope="col" className="px-4 py-2 font-medium">
                  Уровень прав
                </th>
                <th scope="col" className="px-2 py-2">
                  <span className="sr-only">Доступ</span>
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-hairline">
              {users.map((person) => (
                <tr key={person.id} className={person.is_active ? '' : 'bg-red-50/40'}>
                  <td className="max-w-0 px-4 py-2">
                    <div className="flex items-center gap-2.5">
                      {person.avatar ? (
                        <img src={person.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-xs font-semibold text-accent">
                          {person.display_name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 truncate font-medium text-ink">
                          {person.display_name}
                          {person.role === 'owner' && (
                            <ShieldIcon size={14} className="text-accent" />
                          )}
                        </span>
                        <span className="block truncate text-xs text-ink-muted">{person.email}</span>
                      </span>
                    </div>
                  </td>

                  <td className="hidden whitespace-nowrap px-4 py-2 tabular-nums text-ink-muted md:table-cell">
                    {person.documents_count}
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-2 text-ink-muted lg:table-cell">
                    {formatDateTime(person.last_login)}
                  </td>

                  <td className="px-4 py-2">
                    {person.role === 'owner' ? (
                      <span className="text-ink-muted">{ROLE_LABELS.owner}</span>
                    ) : (
                      <Select
                        label={`Уровень прав: ${person.display_name}`}
                        value={person.role}
                        options={ROLES}
                        disabled={!isSuperuser}
                        onChange={(role) => apply(person, { role: role as 'admin' | 'member' })}
                      />
                    )}
                  </td>

                  <td className="px-2 py-2">
                    {person.role !== 'owner' && person.id !== Number(user?.id) && (
                      <button
                        type="button"
                        onClick={() =>
                          person.is_active ? setBlocking(person) : apply(person, { is_active: true })
                        }
                        className={[
                          'flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs',
                          person.is_active
                            ? 'border-hairline text-ink-muted hover:bg-surface-muted hover:text-red-600'
                            : 'border-accent/40 text-accent hover:bg-accent/5',
                        ].join(' ')}
                      >
                        <UserBlockIcon size={15} />
                        {person.is_active ? 'Закрыть доступ' : 'Вернуть доступ'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <NewUserDialog
          canCreateAdmins={isSuperuser}
          onCreated={(person) => {
            setUsers((prev) => [person, ...prev])
            api.adminSummary().then(setSummary).catch(() => undefined)
          }}
          onClose={() => setCreating(false)}
        />
      )}

      {blocking && (
        <ConfirmDialog
          title="Закрыть доступ"
          message={`${blocking.display_name} не сможет войти в систему. Таблицы и выданные права сохранятся — доступ можно вернуть в любой момент.`}
          confirmLabel="Закрыть доступ"
          danger
          onConfirm={() => apply(blocking, { is_active: false })}
          onClose={() => setBlocking(null)}
        />
      )}
    </AppLayout>
  )
}
