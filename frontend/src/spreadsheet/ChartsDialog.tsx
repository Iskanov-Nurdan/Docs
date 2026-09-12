/**
 * Диаграммы по данным листа.
 *
 * Рисуются своим SVG, без сторонней библиотеки: нужны три вида — столбики,
 * линия и круг, — а любая готовая библиотека весит больше всего остального
 * редактора вместе взятого.
 *
 * Настройки диаграммы лежат в листе, поэтому её видят все, кто открыл таблицу.
 * Значения не копируются: диаграмма каждый раз читает те же ячейки, и после
 * правки данных сама показывает новое.
 */
import { useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { PlusIcon, TrashIcon } from '@/components/icons'
import { colLabel } from './formula'
import {
  type ChartSpec,
  type SheetMap,
  charts as chartsOf,
  colCount,
  lastFilledRow,
  newChartId,
  readRaw,
  setCharts,
} from './model'

/** Цвета секторов и столбиков: читаются и на светлом листе, и на тёмном. */
const PALETTE = [
  '#2a7ad6', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
]

const KINDS: Array<{ value: ChartSpec['kind']; label: string }> = [
  { value: 'bar', label: 'Столбики' },
  { value: 'line', label: 'Линия' },
  { value: 'pie', label: 'Круг' },
]

type Props = {
  doc: Y.Doc
  sheet: SheetMap
  version: number
  editable: boolean
  /** Как ячейка выглядит на экране: диаграмма строится по показанному. */
  display: (row: number, col: number) => string
  /** Выделение на момент открытия — по нему предлагаются столбцы. */
  selection: { top: number; left: number; bottom: number; right: number }
  onClose: () => void
}

/** «1 234,50 ₽» — это 1234.5. Текст числом не считается. */
function toNumber(text: string): number | null {
  const cleaned = text.replace(/[^\d,.\-]/g, '').replace(/\s/g, '').replace(',', '.')
  if (!cleaned || cleaned === '-') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

export function ChartsDialog({
  doc, sheet, version, editable, display, selection, onClose,
}: Props) {
  const list = useMemo(() => chartsOf(sheet), [sheet, version])
  const [activeId, setActiveId] = useState<string | null>(list[0]?.id ?? null)

  const cols = colCount(sheet)
  const columnOptions = useMemo(() => {
    const options = []
    for (let col = 0; col < cols; col += 1) {
      const header = readRaw(sheet, 0, col)
      options.push({ value: String(col), label: header?.trim() || `Столбец ${colLabel(col)}` })
    }
    return options
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, cols, version])

  const active = list.find((item) => item.id === activeId) ?? list[0] ?? null

  const addChart = () => {
    const last = lastFilledRow(sheet)
    // По выделению: левый столбец — подписи, следующий — числа. Так чаще
    // всего и выделяют: «Машина» и «Сумма» рядом.
    const spec: ChartSpec = {
      id: newChartId(),
      kind: 'bar',
      title: 'Диаграмма',
      labelCol: selection.left,
      valueCol: Math.min(selection.right > selection.left ? selection.right : selection.left + 1,
                         cols - 1),
      fromRow: Math.max(1, selection.top === selection.bottom ? 1 : selection.top),
      toRow: selection.top === selection.bottom ? Math.max(1, last) : selection.bottom,
    }
    setCharts(doc, sheet, [...list, spec])
    setActiveId(spec.id)
  }

  const update = (patch: Partial<ChartSpec>) => {
    if (!active) return
    setCharts(doc, sheet, list.map((item) =>
      item.id === active.id ? { ...item, ...patch } : item))
  }

  const remove = () => {
    if (!active) return
    setCharts(doc, sheet, list.filter((item) => item.id !== active.id))
    setActiveId(null)
  }

  const data = useMemo(() => {
    if (!active) return []
    const points: Array<{ label: string; value: number }> = []
    for (let row = active.fromRow; row <= active.toRow; row += 1) {
      const value = toNumber(display(row, active.valueCol))
      if (value === null) continue
      points.push({ label: display(row, active.labelCol) || `Строка ${row + 1}`, value })
    }
    return points
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, sheet, version, display])

  return (
    <Modal title="Диаграммы" onClose={onClose} width="lg">
      {list.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {list.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveId(item.id)}
              className={[
                'rounded-full border px-3 py-1.5 text-sm',
                item.id === active?.id
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-hairline text-ink hover:bg-surface-muted',
              ].join(' ')}
            >
              {item.title}
            </button>
          ))}
          {editable && (
            <button
              type="button"
              onClick={addChart}
              className="flex items-center gap-1 rounded-full border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
            >
              <PlusIcon size={15} />
              Ещё
            </button>
          )}
        </div>
      )}

      {!active && (
        <div className="py-8 text-center">
          <p className="mb-3 text-sm text-ink-muted">
            Диаграмма строится по двум столбцам: подписи и числа. Выделите их
            в таблице — или добавьте и выберите столбцы здесь.
          </p>
          <button
            type="button"
            onClick={addChart}
            disabled={!editable}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Построить диаграмму
          </button>
        </div>
      )}

      {active && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm text-ink-muted">Название</span>
              <input
                value={active.title}
                disabled={!editable}
                onChange={(event) => update({ title: event.target.value.slice(0, 60) })}
                className="w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
              />
            </label>

            <div>
              <span className="mb-1 block text-sm text-ink-muted">Вид</span>
              <Select
                label="Вид диаграммы"
                value={active.kind}
                options={KINDS}
                disabled={!editable}
                onChange={(next) => update({ kind: next as ChartSpec['kind'] })}
                block
              />
            </div>

            <div>
              <span className="mb-1 block text-sm text-ink-muted">Подписи</span>
              <Select
                label="Столбец подписей"
                value={String(active.labelCol)}
                options={columnOptions}
                disabled={!editable}
                onChange={(next) => update({ labelCol: Number(next) })}
                block
              />
            </div>

            <div>
              <span className="mb-1 block text-sm text-ink-muted">Числа</span>
              <Select
                label="Столбец чисел"
                value={String(active.valueCol)}
                options={columnOptions}
                disabled={!editable}
                onChange={(next) => update({ valueCol: Number(next) })}
                block
              />
            </div>
          </div>

          {data.length === 0 ? (
            <p className="rounded-xl bg-surface-muted px-3 py-6 text-center text-sm text-ink-muted">
              В выбранном столбце нет чисел. Проверьте, тот ли это столбец и
              те ли строки — сейчас берутся строки с {active.fromRow + 1} по{' '}
              {active.toRow + 1}.
            </p>
          ) : (
            <Chart spec={active} data={data} />
          )}

          {editable && (
            <button
              type="button"
              onClick={remove}
              className="mt-4 flex items-center gap-1.5 text-sm text-red-600 hover:underline"
            >
              <TrashIcon size={15} />
              Удалить диаграмму
            </button>
          )}
        </>
      )}
    </Modal>
  )
}

// ------------------------------- Рисование -------------------------------

type Point = { label: string; value: number }

function Chart({ spec, data }: { spec: ChartSpec; data: Point[] }) {
  if (spec.kind === 'pie') return <PieChart data={data} />
  return <AxisChart spec={spec} data={data} />
}

/** Подпись числа: разряды через пробел, дробная часть — только если есть. */
const formatNumber = (value: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)

/**
 * Столбики и линия рисуются в одних осях: разница только в том, чем
 * соединяются точки. Разводить их по двум компонентам смысла нет.
 */
function AxisChart({ spec, data }: { spec: ChartSpec; data: Point[] }) {
  const width = 720
  const height = 320
  const padding = { top: 24, right: 16, bottom: 56, left: 64 }
  const plotWidth = width - padding.left - padding.right
  const plotHeight = height - padding.top - padding.bottom

  const max = Math.max(...data.map((item) => item.value), 0)
  const min = Math.min(...data.map((item) => item.value), 0)
  const span = max - min || 1

  const y = (value: number) => padding.top + plotHeight - ((value - min) / span) * plotHeight
  const step = plotWidth / data.length
  const x = (index: number) => padding.left + step * index + step / 2

  // Четыре линии сетки: больше превращают поле в клетку и мешают читать.
  const ticks = Array.from({ length: 5 }, (_, index) => min + (span / 4) * index)

  // Подписи по горизонтали на узком месте налезают друг на друга — показываем
  // каждую n-ю, чтобы между ними оставалось не меньше полусотни пикселей.
  const labelStep = Math.max(1, Math.ceil(data.length / Math.floor(plotWidth / 60)))

  return (
    <figure className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full min-w-[520px]"
        role="img"
        aria-label={`${spec.title}: ${data.length} значений`}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="rgb(var(--hairline))"
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={y(tick) + 4}
              textAnchor="end"
              className="fill-[rgb(var(--ink-muted))] text-[11px]"
            >
              {formatNumber(tick)}
            </text>
          </g>
        ))}

        {spec.kind === 'bar'
          ? data.map((item, index) => {
              const top = Math.min(y(item.value), y(0))
              const barHeight = Math.abs(y(item.value) - y(0)) || 1
              return (
                <rect
                  key={index}
                  x={x(index) - Math.min(step * 0.35, 28)}
                  y={top}
                  width={Math.min(step * 0.7, 56)}
                  height={barHeight}
                  rx={3}
                  fill={PALETTE[index % PALETTE.length]}
                >
                  <title>{`${item.label}: ${formatNumber(item.value)}`}</title>
                </rect>
              )
            })
          : (
            <>
              <polyline
                points={data.map((item, index) => `${x(index)},${y(item.value)}`).join(' ')}
                fill="none"
                stroke={PALETTE[0]}
                strokeWidth={2.5}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {data.map((item, index) => (
                <circle key={index} cx={x(index)} cy={y(item.value)} r={3.5} fill={PALETTE[0]}>
                  <title>{`${item.label}: ${formatNumber(item.value)}`}</title>
                </circle>
              ))}
            </>
          )}

        {data.map((item, index) =>
          index % labelStep === 0 ? (
            <text
              key={index}
              x={x(index)}
              y={height - padding.bottom + 18}
              textAnchor="middle"
              className="fill-[rgb(var(--ink-muted))] text-[11px]"
            >
              {item.label.length > 12 ? `${item.label.slice(0, 11)}…` : item.label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="mt-1 text-center text-sm font-medium text-ink">
        {spec.title}
      </figcaption>
    </figure>
  )
}

function PieChart({ data }: { data: Point[] }) {
  // Отрицательные доли круг не показывает: сектор с длиной меньше нуля
  // нарисовать нельзя, а молча менять знак — врать.
  const points = data.filter((item) => item.value > 0)
  const total = points.reduce((sum, item) => sum + item.value, 0)

  if (total === 0) {
    return (
      <p className="rounded-xl bg-surface-muted px-3 py-6 text-center text-sm text-ink-muted">
        Для круга нужны положительные числа.
      </p>
    )
  }

  const size = 260
  const radius = 110
  const center = size / 2

  let angle = -Math.PI / 2
  const sectors = points.map((item, index) => {
    const sweep = (item.value / total) * Math.PI * 2
    const from = angle
    angle += sweep

    const x1 = center + radius * Math.cos(from)
    const y1 = center + radius * Math.sin(from)
    const x2 = center + radius * Math.cos(angle)
    const y2 = center + radius * Math.sin(angle)
    const large = sweep > Math.PI ? 1 : 0

    // Один-единственный сектор дугой не нарисовать: начало и конец совпадают.
    const path = points.length === 1
      ? `M ${center} ${center - radius} A ${radius} ${radius} 0 1 1 ${center - 0.01} ${center - radius} Z`
      : `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`

    return {
      path,
      color: PALETTE[index % PALETTE.length],
      label: item.label,
      value: item.value,
      share: item.value / total,
    }
  })

  return (
    <figure className="flex flex-wrap items-center justify-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Круговая диаграмма">
        {sectors.map((sector, index) => (
          <path key={index} d={sector.path} fill={sector.color}>
            <title>{`${sector.label}: ${formatNumber(sector.value)}`}</title>
          </path>
        ))}
      </svg>

      <ul className="min-w-48 space-y-1 text-sm">
        {sectors.map((sector, index) => (
          <li key={index} className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ background: sector.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-ink">{sector.label}</span>
            <span className="shrink-0 tabular-nums text-ink-muted">
              {Math.round(sector.share * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </figure>
  )
}
