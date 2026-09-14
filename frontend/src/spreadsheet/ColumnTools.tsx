/**
 * Действия над столбцом: сортировка, фильтр, список значений, подсветка.
 *
 * Всё собрано в одном меню на заголовке столбца — там, где человек на столбец
 * и смотрит. Настройки уходят в сам лист, поэтому видны всем, кто открыл
 * таблицу, и переживают перезагрузку.
 */
import { useMemo, useState } from 'react'
import type * as Y from 'yjs'
import { Menu } from '@/components/Menu'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import { ChevronDownIcon } from '@/components/icons'
import { colLabel } from './formula'
import {
  type ColorRule,
  type ColumnFilter,
  type SheetMap,
  colorRules,
  columnFilter,
  filterAccepts,
  frozen,
  lastFilledRow,
  rowHasFormula,
  setColorRules,
  setColumnFilter,
  setFrozen,
  setValidation,
  sortRows,
  validation,
} from './model'
import { STATUS_TONES } from './statuses'

type Dialog = 'filter' | 'values' | 'rule' | null

type Props = {
  doc: Y.Doc
  sheet: SheetMap
  col: number
  /** Меняется на каждую правку книги — повод перечитать значения. */
  version: number
  editable: boolean
  /** Как ячейка выглядит на экране: фильтр работает по показанному. */
  display: (row: number, col: number) => string
}

/** Цвета для своих правил — те же, что у подсказок по смыслу слова. */
const RULE_COLORS = STATUS_TONES.map((tone) => ({
  value: tone.kind,
  label: tone.label,
  background: tone.background,
  color: tone.color,
}))

const OPERATIONS: Array<{ value: ColorRule['op']; label: string }> = [
  { value: 'gt', label: 'Больше' },
  { value: 'lt', label: 'Меньше' },
  { value: 'eq', label: 'Равно' },
  { value: 'contains', label: 'Содержит' },
  { value: 'empty', label: 'Пусто' },
]

export function ColumnTools({ doc, sheet, col, version, editable, display }: Props) {
  const [dialog, setDialog] = useState<Dialog>(null)

  /**
   * Участок строк с данными: от строки под шапкой до последней заполненной.
   *
   * Итоговая строка с формулами в сортировку не попадает — иначе «Итого»
   * уехало бы в середину таблицы, а его формулы считали бы уже не тот участок.
   */
  const range = useMemo(() => {
    const last = lastFilledRow(sheet)
    const total = last > 0 && rowHasFormula(sheet, last)
    return { from: 1, to: total ? last - 1 : last }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, version])

  /** Что вообще встречается в столбце — для фильтра и для списка значений. */
  const uniqueValues = useMemo(() => {
    const seen = new Set<string>()
    for (let row = 1; row <= range.to; row += 1) seen.add(display(row, col))
    return Array.from(seen).sort((a, b) => a.localeCompare(b, 'ru', { numeric: true }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, version, col, range.to, display])

  const activeFilter = columnFilter(sheet, col)
  const listValues = validation(sheet, col)
  const freeze = frozen(sheet)

  const items = [
    {
      label: 'Сортировать по возрастанию',
      disabled: !editable || range.to <= range.from,
      onSelect: () => sortRows(doc, sheet, col, 'asc', range.from, range.to),
    },
    {
      label: 'Сортировать по убыванию',
      disabled: !editable || range.to <= range.from,
      onSelect: () => sortRows(doc, sheet, col, 'desc', range.from, range.to),
    },
    {
      label: activeFilter
        ? (activeFilter.kind === 'range' ? 'Изменить промежуток…' : 'Изменить фильтр…')
        : 'Фильтр…',
      disabled: range.to < 1,
      onSelect: () => setDialog('filter'),
    },
    ...(activeFilter
      ? [{
          label: 'Снять фильтр',
          onSelect: () => setColumnFilter(doc, sheet, col, null),
        }]
      : []),
    {
      label: listValues ? 'Изменить список значений…' : 'Список значений…',
      disabled: !editable,
      onSelect: () => setDialog('values'),
    },
    {
      label: 'Правило подсветки…',
      disabled: !editable,
      onSelect: () => setDialog('rule'),
    },
    {
      label: freeze.cols > col ? 'Снять закрепление столбцов' : 'Закрепить по этот столбец',
      disabled: !editable,
      onSelect: () => setFrozen(doc, sheet, { cols: freeze.cols > col ? 0 : col + 1 }),
    },
  ]

  return (
    <>
      <Menu
        label={`Действия со столбцом ${colLabel(col)}`}
        trigger={<ChevronDownIcon size={13} />}
        align="left"
        items={items}
        className={[
          'rounded p-0.5 text-ink-muted hover:bg-surface hover:text-accent',
          activeFilter ? 'text-accent' : '',
        ].join(' ')}
      />

      {dialog === 'filter' && (
        <FilterDialog
          values={uniqueValues}
          current={activeFilter}
          onApply={(next) => {
            setColumnFilter(doc, sheet, col, next)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'values' && (
        <ValuesDialog
          initial={listValues ?? []}
          suggestion={uniqueValues.filter(Boolean)}
          onApply={(next) => {
            setValidation(doc, sheet, col, next)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'rule' && (
        <RuleDialog
          initial={colorRules(sheet).find((item) => item.col === col) ?? null}
          onApply={(rule) => {
            const rest = colorRules(sheet).filter((item) => item.col !== col)
            setColorRules(doc, sheet, rule ? [...rest, { ...rule, col }] : rest)
            setDialog(null)
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  )
}

// -------------------------------- Окна --------------------------------

const FIELD =
  'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'

function FilterDialog({
  values,
  current,
  onApply,
  onClose,
}: {
  values: string[]
  current: ColumnFilter | null
  onApply: (filter: ColumnFilter | null) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'values' | 'range'>(current?.kind === 'range' ? 'range' : 'values')

  // Фильтра нет — значит показано всё: галочки стоят везде.
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(current?.kind === 'values' ? current.values : values),
  )
  const [from, setFrom] = useState(current?.kind === 'range' ? current.from : '')
  const [to, setTo] = useState(current?.kind === 'range' ? current.to : '')

  const toggle = (value: string) =>
    setChecked((next) => {
      const updated = new Set(next)
      if (updated.has(value)) updated.delete(value)
      else updated.add(value)
      return updated
    })

  // Сколько строк останется — видно до нажатия, чтобы не применять вслепую.
  const matching = useMemo(() => {
    if (mode === 'values') return values.filter((value) => checked.has(value)).length
    const filter: ColumnFilter = { kind: 'range', from, to }
    return values.filter((value) => filterAccepts(filter, value)).length
  }, [mode, values, checked, from, to])

  const apply = () => {
    if (mode === 'values') onApply({ kind: 'values', values: Array.from(checked) })
    else if (!from.trim() && !to.trim()) onApply(null)
    else onApply({ kind: 'range', from: from.trim(), to: to.trim() })
  }

  const tab = (value: 'values' | 'range', label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={[
        'rounded-full px-3 py-1.5 text-sm',
        mode === value ? 'bg-accent/10 font-medium text-accent' : 'text-ink-muted hover:bg-surface-muted',
      ].join(' ')}
    >
      {label}
    </button>
  )

  return (
    <Modal
      title="Фильтр по столбцу"
      onClose={onClose}
      width="sm"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApply(null)}
            className="rounded-full border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Показать всё
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={apply}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Применить
          </button>
        </div>
      }
    >
      <div className="mb-3 flex gap-1">
        {tab('values', 'По значениям')}
        {tab('range', 'Промежуток')}
      </div>

      {mode === 'values' ? (
        <>
          <div className="mb-2 flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setChecked(new Set(values))}
              className="text-accent hover:underline"
            >
              Выбрать все
            </button>
            <button
              type="button"
              onClick={() => setChecked(new Set())}
              className="text-accent hover:underline"
            >
              Снять все
            </button>
          </div>

          <ul className="max-h-64 overflow-y-auto">
            {values.map((value) => (
              <li key={value}>
                <label className="flex items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={checked.has(value)}
                    onChange={() => toggle(value)}
                    className="h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                  />
                  <span className="truncate text-ink">
                    {value === '' ? <span className="text-ink-muted">(пустые)</span> : value}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mb-3 text-sm text-ink-muted">
            Отбор по времени, дате или числу. Можно заполнить одно поле:
            только «от» — всё позднее, только «до» — всё раньше.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm text-ink-muted">От</span>
              <input
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder="11.09.2026 или 100000"
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm text-ink-muted">До</span>
              <input
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="14.09.2026 или 500000"
                className={FIELD}
              />
            </label>
          </div>

          <p className="mt-3 text-xs text-ink-muted">
            Дата без времени в поле «до» означает конец того дня — строка,
            пришедшая в тот же день вечером, из отбора не выпадет.
          </p>
        </>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Подойдёт значений: {matching} из {values.length}
      </p>
    </Modal>
  )
}

function ValuesDialog({
  initial,
  suggestion,
  onApply,
  onClose,
}: {
  initial: string[]
  suggestion: string[]
  onApply: (values: string[] | null) => void
  onClose: () => void
}) {
  const [text, setText] = useState(initial.join('\n'))

  const values = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  return (
    <Modal
      title="Список значений"
      onClose={onClose}
      width="sm"
      footer={
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApply(null)}
            className="rounded-full border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Убрать список
          </button>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => onApply(values)}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Сохранить
          </button>
        </div>
      }
    >
      <p className="mb-2 text-sm text-ink-muted">
        В ячейках этого столбца появится выбор из списка. Значение с новой
        строки — один пункт.
      </p>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={7}
        placeholder={'В пути\nПрибыл\nПросрочка'}
        className={`${FIELD} resize-y font-mono`}
      />

      {suggestion.length > 0 && (
        <button
          type="button"
          onClick={() => setText(suggestion.join('\n'))}
          className="mt-2 text-xs text-accent hover:underline"
        >
          Взять то, что уже есть в столбце ({suggestion.length})
        </button>
      )}
    </Modal>
  )
}

function RuleDialog({
  initial,
  onApply,
  onClose,
}: {
  initial: ColorRule | null
  onApply: (rule: Omit<ColorRule, 'col'> | null) => void
  onClose: () => void
}) {
  const [op, setOp] = useState<ColorRule['op']>(initial?.op ?? 'gt')
  const [value, setValue] = useState(initial?.value ?? '')
  const [tone, setTone] = useState(
    () => RULE_COLORS.find((item) => item.background === initial?.background) ?? RULE_COLORS[0],
  )

  return (
    <Modal
      title="Правило подсветки"
      onClose={onClose}
      width="sm"
      footer={
        <div className="flex items-center gap-2">
          {initial && (
            <button
              type="button"
              onClick={() => onApply(null)}
              className="rounded-full border border-hairline px-4 py-2 text-sm text-red-600 hover:bg-surface-muted"
            >
              Убрать правило
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            onClick={() =>
              onApply({ op, value, background: tone.background, color: tone.color })
            }
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Сохранить
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-ink-muted">
        Ячейки столбца покрасятся, когда условие выполнено. Правило сильнее
        подсказки по смыслу слова, но слабее заливки, выбранной вручную.
      </p>

      <div className="mb-3">
        <span className="mb-1 block text-sm text-ink-muted">Условие</span>
        <Select
          label="Условие"
          value={op}
          options={OPERATIONS}
          onChange={(next) => setOp(next as ColorRule['op'])}
          block
        />
      </div>

      {op !== 'empty' && (
        <label className="mb-3 block">
          <span className="mb-1 block text-sm text-ink-muted">Значение</span>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="100000 или «просрочка»"
            className={FIELD}
          />
        </label>
      )}

      <div className="mb-1">
        <span className="mb-1 block text-sm text-ink-muted">Цвет</span>
        <div className="flex flex-wrap gap-2">
          {RULE_COLORS.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => setTone(item)}
              style={{ background: item.background, color: item.color }}
              className={[
                'rounded-full px-3 py-1.5 text-sm',
                tone.value === item.value ? 'ring-2 ring-accent' : '',
              ].join(' ')}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  )
}
