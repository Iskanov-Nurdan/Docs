/**
 * Точки и время в пути между ними.
 *
 * Справочник общий на всю контору: по нему таблицы сами ставят срок прибытия.
 * Смотреть может каждый — водителю и диспетчеру полезно знать норматив, —
 * а заводить и править точки разрешено администратору.
 */
import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/AppLayout'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { Select } from '@/components/Select'
import { PlusIcon, TrashIcon } from '@/components/icons'
import { ApiError, api } from '@/api'
import { useAuth } from '@/store/auth'
import { useRoutes } from '@/store/routes'
import type { Place, RouteLeg } from '@/types'

/**
 * Отказ сервера человеческим языком.
 *
 * В ответе на неверные поля лежит разбор по каждому: без него человек видит
 * «Проверьте заполненные поля» и не понимает, какое именно.
 */
function explain(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  const fields = error.fields
  if (fields) {
    const first = Object.values(fields).flat().find(Boolean)
    if (typeof first === 'string') return first
  }
  return error.message || fallback
}

const FIELD =
  'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'

export function RoutesPage() {
  const { user } = useAuth()
  const { places, legs, loading, error, load } = useRoutes()
  const canEdit = Boolean(user?.is_staff)

  const [placeName, setPlaceName] = useState('')
  const [origin, setOrigin] = useState('')
  const [destination, setDestination] = useState('')
  const [hours, setHours] = useState('')
  const [both, setBoth] = useState(true)
  const [message, setMessage] = useState('')
  const [removing, setRemoving] = useState<{ kind: 'place' | 'leg'; item: Place | RouteLeg } | null>(null)

  useEffect(() => {
    load(true)
  }, [load])

  /**
   * Выбранные точки должны существовать.
   *
   * Точку могли только что удалить — тогда в поле остаётся идентификатор,
   * которого уже нет, и сервер отвечает отказом на непонятном языке. Здесь
   * выбор возвращается к первой доступной точке.
   */
  useEffect(() => {
    if (places.length === 0) return
    const known = new Set(places.map((place) => place.id))
    if (!known.has(origin)) setOrigin(places[0].id)
    if (!known.has(destination)) setDestination(places[1]?.id ?? places[0].id)
  }, [places, origin, destination])

  const options = useMemo(
    () => places.map((place) => ({ value: place.id, label: place.name })),
    [places],
  )

  const say = (text: string) => {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 4000)
  }

  const addPlace = async (event: React.FormEvent) => {
    event.preventDefault()
    const name = placeName.trim()
    if (!name) return
    try {
      await api.createPlace({ name })
      setPlaceName('')
      await load(true)
      say(`Точка «${name}» добавлена`)
    } catch (err) {
      say(explain(err, 'Не удалось добавить точку'))
    }
  }

  const addLeg = async (event: React.FormEvent) => {
    event.preventDefault()
    const value = Number(hours.replace(',', '.'))
    if (!origin || !destination || !Number.isFinite(value) || value <= 0) {
      say('Укажите обе точки и время в часах')
      return
    }
    if (origin === destination) {
      say('Откуда и куда — одна и та же точка')
      return
    }

    try {
      await api.createRouteLeg({ origin, destination, hours: value })
      // Дорога назад занимает столько же — заводим сразу обе, иначе вторую
      // половину маршрутов пришлось бы вбивать руками.
      if (both) {
        await api.createRouteLeg({ origin: destination, destination: origin, hours: value })
          .catch(() => undefined)
      }
      setHours('')
      await load(true)
      say('Маршрут сохранён')
    } catch (err) {
      say(explain(err, 'Не удалось сохранить маршрут'))
    }
  }

  const changeHours = async (leg: RouteLeg, next: string) => {
    const value = Number(next.replace(',', '.'))
    if (!Number.isFinite(value) || value <= 0) return
    try {
      await api.updateRouteLeg(leg.id, { hours: value })
      await load(true)
    } catch {
      say('Не удалось изменить время')
    }
  }

  const remove = async () => {
    if (!removing) return
    try {
      if (removing.kind === 'place') await api.deletePlace(removing.item.id)
      else await api.deleteRouteLeg(removing.item.id)
      await load(true)
      say('Удалено')
    } catch {
      say('Не удалось удалить')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <AppLayout title="Точки и маршруты">
      <p className="mb-4 max-w-2xl text-sm text-ink-muted">
        По этому справочнику таблицы сами ставят срок прибытия: выбрали «Откуда»
        и «Куда», написали время выезда — время прибытия подставится, а когда
        оно пройдёт, строка покраснеет. Проставленный руками срок таблица не
        трогает.
      </p>

      {message && (
        <p role="status" className="mb-4 rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink">
          {message}
        </p>
      )}

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Точки ({places.length})</h2>

          {canEdit && (
            <form onSubmit={addPlace} className="mb-3 flex gap-2">
              <input
                value={placeName}
                onChange={(event) => setPlaceName(event.target.value)}
                placeholder="Например, Кашгар"
                className={FIELD}
              />
              <button
                type="submit"
                className="flex shrink-0 items-center gap-1 rounded-full bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                <PlusIcon size={16} />
              </button>
            </form>
          )}

          <ul className="divide-y divide-hairline rounded-xl border border-hairline bg-surface">
            {places.map((place) => (
              <li key={place.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <span className="flex-1 truncate text-ink">{place.name}</span>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setRemoving({ kind: 'place', item: place })}
                    aria-label={`Удалить точку ${place.name}`}
                    className="rounded-full p-1 text-ink-muted hover:bg-surface-muted hover:text-red-600"
                  >
                    <TrashIcon size={15} />
                  </button>
                )}
              </li>
            ))}
            {!loading && places.length === 0 && (
              <li className="px-3 py-6 text-center text-sm text-ink-muted">Точек пока нет</li>
            )}
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-ink">Время в пути ({legs.length})</h2>

          {canEdit && places.length > 1 && (
            <form onSubmit={addLeg} className="mb-3 grid gap-2 rounded-xl border border-hairline bg-surface p-3 sm:grid-cols-[1fr_1fr_120px_auto]">
              <div>
                <span className="mb-1 block text-xs text-ink-muted">Откуда</span>
                <Select label="Откуда" value={origin} options={options} onChange={setOrigin} block />
              </div>
              <div>
                <span className="mb-1 block text-xs text-ink-muted">Куда</span>
                <Select label="Куда" value={destination} options={options} onChange={setDestination} block />
              </div>
              <label className="block">
                <span className="mb-1 block text-xs text-ink-muted">Часов</span>
                <input
                  value={hours}
                  onChange={(event) => setHours(event.target.value)}
                  placeholder="10"
                  inputMode="decimal"
                  className={FIELD}
                />
              </label>
              <div className="flex items-end">
                <button
                  type="submit"
                  className="w-full rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                >
                  Добавить
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-ink-muted sm:col-span-4">
                <input
                  type="checkbox"
                  checked={both}
                  onChange={(event) => setBoth(event.target.checked)}
                  className="h-4 w-4 accent-[rgb(var(--accent))]"
                />
                Завести и обратное направление с тем же временем
              </label>
            </form>
          )}

          <div className="overflow-x-auto rounded-xl border border-hairline bg-surface">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-ink-muted">
                  <th scope="col" className="px-3 py-2 font-medium">Откуда</th>
                  <th scope="col" className="px-3 py-2 font-medium">Куда</th>
                  <th scope="col" className="px-3 py-2 font-medium">Часов в пути</th>
                  <th scope="col" className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {legs.map((leg) => (
                  <tr key={leg.id}>
                    <td className="px-3 py-2 text-ink">{leg.origin_name}</td>
                    <td className="px-3 py-2 text-ink">{leg.destination_name}</td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <input
                          defaultValue={String(Number(leg.hours))}
                          onBlur={(event) => changeHours(leg, event.target.value)}
                          aria-label={`Часов: ${leg.origin_name} — ${leg.destination_name}`}
                          inputMode="decimal"
                          className="w-24 rounded border border-hairline bg-surface px-2 py-1 text-sm outline-none focus:border-accent"
                        />
                      ) : (
                        <span className="tabular-nums text-ink">{Number(leg.hours)} ч</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => setRemoving({ kind: 'leg', item: leg })}
                          aria-label={`Удалить маршрут ${leg.origin_name} — ${leg.destination_name}`}
                          className="rounded-full p-1 text-ink-muted hover:bg-surface-muted hover:text-red-600"
                        >
                          <TrashIcon size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && legs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-ink-muted">
                      Маршрутов пока нет
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {removing && (
        <ConfirmDialog
          title="Удалить"
          message={
            removing.kind === 'place'
              ? `Точка «${(removing.item as Place).name}» исчезнет из списков, вместе с ней — маршруты через неё. Таблицы, где она уже написана, не изменятся.`
              : 'Маршрут удалится, и срок по нему подставляться перестанет.'
          }
          confirmLabel="Удалить"
          danger
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        />
      )}
    </AppLayout>
  )
}
