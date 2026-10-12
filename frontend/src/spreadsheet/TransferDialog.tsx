/**
 * Окно перегруза: где переложили груз и на какую машину.
 *
 * Спрашиваем только то, что нельзя взять из строки: место, новую машину и
 * водителя. Груз, вес и конечная точка переезжают сами (см. transfer.ts).
 */
import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/Modal'
import { useRoutes } from '@/store/routes'

type Props = {
  /** Машина, с которой перегружают: «01KG777». */
  vehicle: string
  /** Конечная точка груза — она не меняется. */
  destination: string
  /** Оставшиеся точки по пути: перегружают обычно на одной из них. */
  places: string[]
  /** Есть ли в таблице колонка водителя — иначе поле не спрашиваем. */
  hasDriver: boolean
  onSubmit: (value: { place: string; vehicle: string; driver: string }) => string | null
  onClose: () => void
}

export function TransferDialog({ vehicle, destination, places, hasDriver, onSubmit, onClose }: Props) {
  const [place, setPlace] = useState(places[0] ?? '')
  const [nextVehicle, setNextVehicle] = useState('')
  const [driver, setDriver] = useState('')
  const [error, setError] = useState('')

  // Подсказки места: сначала точки этого рейса, потом весь справочник.
  const { places: known, load } = useRoutes()
  useEffect(() => {
    load()
  }, [load])
  const options = useMemo(() => {
    const names = [...places, ...known.map((item) => item.name)]
    return Array.from(new Set(names.filter(Boolean)))
  }, [places, known])

  const fieldClass =
    'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const problem = onSubmit({ place, vehicle: nextVehicle, driver })
    if (problem) setError(problem)
  }

  return (
    <Modal title="Перегруз на другую машину" onClose={onClose} width="sm">
      <form onSubmit={submit}>
        <p className="mb-4 text-sm text-ink-muted">
          {vehicle ? `Машина ${vehicle}` : 'Эта машина'} закончит путь в месте перегруза
          и получит статус «Перегружен». Груз поедет дальше в {destination} новой строкой
          с тем же номером груза. Стоимость и налог останутся в первой строке.
        </p>

        <datalist id="transfer-places">
          {options.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Где перегрузили</span>
          <input
            value={place}
            list="transfer-places"
            autoFocus={!place}
            required
            onChange={(event) => setPlace(event.target.value)}
            placeholder="Кара-Тай"
            className={fieldClass}
          />
        </label>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Новая машина</span>
          <input
            value={nextVehicle}
            autoFocus={Boolean(place)}
            required
            onChange={(event) => setNextVehicle(event.target.value)}
            placeholder="02KG123"
            className={fieldClass}
          />
        </label>

        {hasDriver && (
          <label className="mb-4 block">
            <span className="mb-1 block text-sm text-ink-muted">Водитель</span>
            <input
              value={driver}
              onChange={(event) => setDriver(event.target.value)}
              className={fieldClass}
            />
          </label>
        )}

        {error && (
          <p role="alert" className="mb-4 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={!place.trim() || !nextVehicle.trim()}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Перегрузить
          </button>
        </div>
      </form>
    </Modal>
  )
}
