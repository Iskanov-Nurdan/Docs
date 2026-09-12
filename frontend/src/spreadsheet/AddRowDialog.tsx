/**
 * Добавление записи формой, а не по ячейкам.
 *
 * Набивать рейс прямо в сетке неудобно: колонок дюжина, часть уезжает за край,
 * и с телефона попасть в нужную клетку почти нельзя. Форма показывает те же
 * колонки списком сверху вниз, в один экран.
 *
 * Поля берутся из шапки открытой таблицы, а не задаются здесь списком: тогда
 * одна кнопка работает и в журнале рейсов, и в заказах, и в самодельной
 * таблице — и не ломается, когда колонку переименовали.
 *
 * Колонки, где в предыдущей строке стоит формула, не спрашиваются: формула
 * переносится сама, как при протягивании вниз. Сумму незачем считать руками,
 * если таблица уже умеет её считать.
 *
 * Маршрут с промежуточными точками разворачивается в несколько строк — по
 * строке на плечо. Иначе срок у рейса был бы один, конечный, и застрявшую
 * посередине машину таблица заметила бы только в самом конце пути.
 */
import { useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { CloseIcon, PlusIcon } from '@/components/icons'
import {
  MAX_ROWS,
  type SheetMap,
  growRows,
  insertRow,
  lastFilledRow,
  readRaw,
  rowCount,
  rowHasFormula,
  shiftFormulaToRow,
  writeCell,
} from './model'
import { STATUS_TONES, isDeadlineHeader, parseDeadline } from './statuses'

type FieldKind = 'text' | 'deadline' | 'status' | 'formula' | 'from' | 'to' | 'departure'

type Field = {
  col: number
  label: string
  kind: FieldKind
  /** Для колонки с формулой — та формула из строки-образца. */
  formula?: string
}

/** Промежуточная точка: пункт и время прибытия в него. */
type Waypoint = { place: string; arrive: string }

const HEADERS: Record<'from' | 'to' | 'status' | 'departure', string[]> = {
  from: ['откуда', 'from', 'кайдан', 'пункт отправ', 'отправление', '出发地', '起点'],
  to: ['куда', 'to', 'кайда', 'пункт назнач', 'назначение', '目的地', '终点'],
  status: ['статус', 'состояние', 'status', 'абал', '状态', '状况'],
  departure: ['вышел', 'выехал', 'выезд', 'отправил', 'погруз', 'чыкты', 'жонот',
              'departure', 'left', 'shipped', '发车', '出发时间'],
}

function headerIs(text: string | null, group: keyof typeof HEADERS): boolean {
  if (!text) return false
  const normalized = text.trim().toLowerCase()
  return HEADERS[group].some((header) => normalized.startsWith(header))
}

type Props = {
  doc: Y.Doc
  sheet: SheetMap
  /** Меняется на каждую правку книги — повод перечитать шапку. */
  version: number
  cols: number
  onAdded: (row: number) => void
  onClose: () => void
}

export function AddRowDialog({ doc, sheet, version, cols, onAdded, onClose }: Props) {
  /**
   * Куда встанет запись и откуда взять формулы.
   *
   * Если таблица заканчивается строкой с формулами — это итог, и запись должна
   * попасть над ним: иначе она окажется ниже суммы и в неё не войдёт.
   */
  const plan = useMemo(() => {
    const last = lastFilledRow(sheet)
    const total = last > 0 && rowHasFormula(sheet, last)
    return {
      /** Строка, в которую пишем. */
      target: total ? last : last + 1,
      /** Строка-образец: из неё переносятся формулы. */
      sample: total ? last - 1 : last,
      /** Строка итога, если она есть: по ней видно, какие колонки суммируются. */
      totalRow: total ? last : -1,
      /** Итог внизу поедет вниз, поэтому строки вставляем, а не просто пишем. */
      insert: total,
      empty: last < 0,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, version])

  const fields = useMemo<Field[]>(() => {
    const list: Field[] = []
    for (let col = 0; col < cols; col += 1) {
      const header = readRaw(sheet, 0, col)
      if (!header || !header.trim()) continue

      const sample = plan.sample > 0 ? readRaw(sheet, plan.sample, col) : null
      if (sample && sample.startsWith('=')) {
        list.push({ col, label: header, kind: 'formula', formula: sample })
        continue
      }

      const kind: FieldKind = headerIs(header, 'from')
        ? 'from'
        : headerIs(header, 'to')
          ? 'to'
          : isDeadlineHeader(header)
            ? 'deadline'
            : headerIs(header, 'status')
              ? 'status'
              : headerIs(header, 'departure')
                ? 'departure'
                : 'text'
      list.push({ col, label: header, kind })
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, cols, version, plan.sample])

  const route = useMemo(() => {
    const find = (kind: FieldKind) => fields.find((item) => item.kind === kind)
    const from = find('from')
    const to = find('to')
    return {
      from,
      to,
      arrive: find('deadline'),
      /** Маршрут по точкам возможен, только когда есть откуда и куда. */
      supported: Boolean(from && to),
    }
  }, [fields])

  /**
   * Колонки, которые суммируются итогом.
   *
   * В плечах маршрута они остаются пустыми: сумма закупа относится к рейсу
   * целиком, и продублированная по трём строкам она утроила бы итог.
   */
  const summed = useMemo(() => {
    const set = new Set<number>()
    if (plan.totalRow < 0) return set
    for (const item of fields) {
      const value = readRaw(sheet, plan.totalRow, item.col)
      if (value && value.startsWith('=')) set.add(item.col)
    }
    return set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, sheet, version, plan.totalRow])

  const [values, setValues] = useState<Record<number, string>>({})
  const [waypoints, setWaypoints] = useState<Waypoint[]>([])

  const set = (col: number, value: string) =>
    setValues((current) => ({ ...current, [col]: value }))

  const setWaypoint = (index: number, patch: Partial<Waypoint>) =>
    setWaypoints((current) =>
      current.map((point, position) => (position === index ? { ...point, ...patch } : point)),
    )

  const filled =
    fields.some((item) => item.kind !== 'formula' && (values[item.col] ?? '').trim() !== '') ||
    waypoints.some((point) => point.place.trim() !== '')

  const fieldClass =
    'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'

  /** Плечи маршрута: A→точка, точка→точка, точка→Б. Без точек — одно плечо. */
  const legs = useMemo(() => {
    const from = route.from ? (values[route.from.col] ?? '') : ''
    const to = route.to ? (values[route.to.col] ?? '') : ''
    const arrive = route.arrive ? (values[route.arrive.col] ?? '') : ''

    const stops = waypoints.filter((point) => point.place.trim() !== '')
    if (!route.supported || stops.length === 0) return [{ from, to, arrive }]

    const result = []
    let previous = from
    for (const stop of stops) {
      result.push({ from: previous, to: stop.place, arrive: stop.arrive })
      previous = stop.place
    }
    result.push({ from: previous, to, arrive })
    return result
  }, [route, values, waypoints])

  /** Число — это про рейс целиком: в плечах повторять его нельзя. */
  const isNumeric = (value: string) => /^-?[\d\s.,]+$/.test(value.trim())

  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!filled) return
    if (plan.target + legs.length > MAX_ROWS) return

    doc.transact(() => {
      if (plan.insert) {
        // Каждая вставка сдвигает итог ниже и расширяет его формулы.
        for (let i = 0; i < legs.length; i += 1) insertRow(doc, sheet, plan.target)
      }
      const needed = plan.target + legs.length - rowCount(sheet)
      if (needed > 0) growRows(doc, sheet, needed)

      legs.forEach((leg, index) => {
        const row = plan.target + index
        const first = index === 0

        for (const item of fields) {
          if (item.kind === 'from') {
            if (leg.from.trim()) writeCell(doc, sheet, row, item.col, leg.from.trim())
            continue
          }
          if (item.kind === 'to') {
            if (leg.to.trim()) writeCell(doc, sheet, row, item.col, leg.to.trim())
            continue
          }
          if (item.kind === 'deadline' && route.arrive?.col === item.col) {
            if (leg.arrive.trim()) writeCell(doc, sheet, row, item.col, leg.arrive.trim())
            continue
          }
          // Время выезда известно только для первого плеча: когда машина
          // тронулась с промежуточной точки, никто не записывает.
          if (item.kind === 'departure' && !first) continue
          if (summed.has(item.col) && !first) continue

          if (item.kind === 'formula') {
            writeCell(
              doc, sheet, row, item.col,
              shiftFormulaToRow(item.formula ?? '', plan.sample, row),
            )
            continue
          }

          const value = (values[item.col] ?? '').trim()
          if (!value) continue
          if (!first && isNumeric(value)) continue
          writeCell(doc, sheet, row, item.col, value)
        }
      })
    })

    onAdded(plan.target)
    onClose()
  }

  if (plan.empty || fields.length === 0) {
    return (
      <Modal title="Добавить запись" onClose={onClose} width="sm">
        <p className="text-sm text-ink">
          Форме не из чего собрать поля: в первой строке таблицы нет названий
          колонок. Впишите в неё заголовки — «Машина», «Откуда», «Куда»,
          «Прибытие» — и откройте форму снова.
        </p>
      </Modal>
    )
  }

  const deadlineHint = (value: string) =>
    value.trim() !== '' && parseDeadline(value) === null ? (
      <span className="mt-1 block text-xs text-amber-600">
        Не похоже на время. Просрочка по этой точке считаться не будет —
        напишите «18:00» или «11.09.2026 18:00».
      </span>
    ) : null

  /** Блок маршрута целиком: откуда, точки по пути, куда и срок прибытия. */
  const routeBlock = (
    <div className="mb-4 rounded-xl border border-hairline p-3">
      <span className="mb-2 block text-sm font-medium text-ink">Маршрут</span>

      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-muted">{route.from?.label}</span>
        <input
          value={route.from ? (values[route.from.col] ?? '') : ''}
          autoFocus
          onChange={(event) => route.from && set(route.from.col, event.target.value)}
          className={fieldClass}
        />
      </label>

      {waypoints.map((point, index) => (
        <div key={index} className="mb-3 rounded-xl bg-surface-muted p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="flex-1 text-xs text-ink-muted">Точка по пути {index + 1}</span>
            <button
              type="button"
              onClick={() => setWaypoints((current) => current.filter((_, i) => i !== index))}
              aria-label={`Убрать точку ${index + 1}`}
              className="rounded-full p-1 text-ink-muted hover:bg-surface"
            >
              <CloseIcon size={14} />
            </button>
          </div>
          <input
            value={point.place}
            placeholder="Пункт"
            onChange={(event) => setWaypoint(index, { place: event.target.value })}
            className={`${fieldClass} mb-2`}
          />
          {route.arrive && (
            <>
              <input
                value={point.arrive}
                placeholder={`${route.arrive.label} — 14:00`}
                onChange={(event) => setWaypoint(index, { arrive: event.target.value })}
                className={fieldClass}
              />
              {deadlineHint(point.arrive)}
            </>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => setWaypoints((current) => [...current, { place: '', arrive: '' }])}
        className="mb-3 flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
      >
        <PlusIcon size={15} />
        Точка по пути
      </button>

      <label className="mb-3 block">
        <span className="mb-1 block text-sm text-ink-muted">{route.to?.label}</span>
        <input
          value={route.to ? (values[route.to.col] ?? '') : ''}
          onChange={(event) => route.to && set(route.to.col, event.target.value)}
          className={fieldClass}
        />
      </label>

      {route.arrive && (
        <label className="block">
          <span className="mb-1 block text-sm text-ink-muted">{route.arrive.label}</span>
          <input
            value={values[route.arrive.col] ?? ''}
            placeholder="18:00 или 11.09.2026 18:00"
            onChange={(event) => route.arrive && set(route.arrive.col, event.target.value)}
            className={fieldClass}
          />
          {deadlineHint(values[route.arrive.col] ?? '')}
        </label>
      )}

      {waypoints.some((point) => point.place.trim() !== '') && (
        <p className="mt-3 text-xs text-ink-muted">
          Получится строк: {legs.length} — по одной на участок пути. Суммы
          встанут в первую, чтобы итог не сложил их несколько раз.
        </p>
      )}
    </div>
  )

  return (
    <Modal title="Добавить запись" onClose={onClose} width="sm">
      <form onSubmit={submit}>
        <p className="mb-4 text-xs text-ink-muted">
          Запись встанет в строку {plan.target + 1}
          {plan.insert && ' — над итогом, чтобы попасть в сумму'}.
        </p>

        {fields.map((item, index) => {
          const value = values[item.col] ?? ''

          // Маршрут показывается одним блоком на месте колонки «Откуда»;
          // «Куда» и срок прибытия входят в него же.
          if (route.supported && item.kind === 'from') return <div key={item.col}>{routeBlock}</div>
          if (route.supported && (item.kind === 'to' || route.arrive?.col === item.col)) return null

          if (item.kind === 'formula') {
            return (
              <div key={item.col} className="mb-4">
                <span className="mb-1 block text-sm text-ink-muted">{item.label}</span>
                <p className="rounded-xl bg-surface-muted px-3 py-2 text-sm text-ink-muted">
                  Считается формулой
                </p>
              </div>
            )
          }

          if (item.kind === 'status') {
            return (
              <div key={item.col} className="mb-4">
                <span className="mb-1 block text-sm text-ink-muted">{item.label}</span>
                <Select
                  label={item.label}
                  value={value}
                  options={[
                    { value: '', label: 'Не указан' },
                    ...STATUS_TONES.map((tone) => ({ value: tone.label, label: tone.label })),
                  ]}
                  onChange={(next) => set(item.col, next)}
                  block
                />
              </div>
            )
          }

          return (
            <label key={item.col} className="mb-4 block">
              <span className="mb-1 block text-sm text-ink-muted">{item.label}</span>
              <input
                value={value}
                autoFocus={index === 0 && !route.supported}
                placeholder={item.kind === 'deadline' ? '18:00 или 11.09.2026 18:00' : undefined}
                onChange={(event) => set(item.col, event.target.value)}
                className={fieldClass}
              />
              {/* Срок, который таблица не разобрала, не покраснеет при опоздании.
                  Молча пропустить это нельзя — ради просрочки колонку и ведут. */}
              {item.kind === 'deadline' && deadlineHint(value)}
            </label>
          )
        })}

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
            disabled={!filled}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {legs.length > 1 ? `Добавить ${legs.length} строки` : 'Добавить'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
