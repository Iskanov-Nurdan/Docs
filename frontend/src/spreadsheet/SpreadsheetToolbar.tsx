/** Панель инструментов таблицы. */
import {
  AlignCenterIcon,
  AlignLeftIcon,
  AlignRightIcon,
  ChartIcon,
  CheckIcon,
  ColumnIcon,
  EraserIcon,
  PinIcon,
  RouteIcon,
  PlusIcon,
  RedoIcon,
  RowIcon,
  SearchIcon,
  UndoIcon,
  UploadIcon,
} from '@/components/icons'
import { Select } from '@/components/Select'
import { STATUS_TONES } from './statuses'
import { ToolbarButton } from './ToolbarButton'
import type { Align, CellStyle, NumberFormat } from './model'

// Подсказка показывает, как будет выглядеть число: по одному названию валюты
// не видно ни разрядов, ни места знака, и выбирать приходится наугад.
// Сом и юань стоят выше рубля: торгуют в них, а не в нём.
const FORMATS: Array<{ value: NumberFormat; label: string; hint?: string }> = [
  { value: 'auto', label: 'Автоматически' },
  { value: 'number', label: 'Число', hint: '1 234,50' },
  { value: 'percent', label: 'Процент', hint: '12,5%' },
  { value: 'currency_kgs', label: 'Деньги, сом', hint: '1 234,50 сом' },
  { value: 'currency_cny', label: 'Деньги, юань', hint: '1 234,50 ¥' },
  { value: 'currency_usd', label: 'Деньги, доллар', hint: '1 234,50 $' },
  { value: 'currency', label: 'Деньги, рубль', hint: '1 234,50 ₽' },
  { value: 'date', label: 'Дата' },
  { value: 'text', label: 'Текст' },
]

type Props = {
  editable: boolean
  /** Оформление ячейки под курсором — по нему подсвечиваются кнопки. */
  style: CellStyle
  onStyle: (patch: CellStyle) => void
  onUndo: () => void
  onRedo: () => void
  onInsertRow: () => void
  onDeleteRow: () => void
  onInsertCol: () => void
  onDeleteCol: () => void
  /** Вписать слово в выделенные ячейки: статус красится по смыслу сам. */
  onFill: (value: string) => void
  onFind: () => void
  /** Форма добавления записи: заполнить рейс по полям, а не по ячейкам. */
  onAddRow: () => void
  /** Закреплена ли шапка — кнопка работает переключателем. */
  headerFrozen: boolean
  onToggleFreeze: () => void
  onCharts: () => void
  /** Отметить прибытие машины в строке под курсором. */
  onArrived: () => void
  /** Посчитать сроки прибытия по всей таблице. */
  onFillArrivals: () => void
  /** Выбрать файл Excel или CSV и перенести его листы в книгу. */
  onImport: () => void
}

export function SpreadsheetToolbar({
  editable,
  style,
  onStyle,
  onUndo,
  onRedo,
  onInsertRow,
  onDeleteRow,
  onInsertCol,
  onDeleteCol,
  onFill,
  onFind,
  onAddRow,
  headerFrozen,
  onToggleFreeze,
  onCharts,
  onArrived,
  onFillArrivals,
  onImport,
}: Props) {
  const disabled = !editable

  const divider = <span className="mx-1 h-5 w-px shrink-0 bg-hairline" aria-hidden="true" />

  const align = (value: Align, label: React.ReactNode, title: string) => (
    <ToolbarButton
      label={label}
      title={title}
      disabled={disabled}
      active={style.align === value}
      onClick={() => onStyle({ align: style.align === value ? undefined : value })}
    />
  )

  return (
    <div
      role="toolbar"
      aria-label="Форматирование таблицы"
      // На телефоне панель едет вбок одной строкой, а не переносится: четыре
      // ряда кнопок на маленьком экране не оставляют места самой таблице.
      // На широком экране перенос уместнее — там прокрутка вбок незаметна.
      className="no-scrollbar flex snap-x items-center gap-1 overflow-x-auto border-b border-hairline bg-surface px-3 py-1.5 sm:flex-wrap sm:overflow-visible"
    >
      <ToolbarButton label={<UndoIcon size={17} />} title="Отменить (Ctrl+Z)" disabled={disabled} onClick={onUndo} />
      <ToolbarButton label={<RedoIcon size={17} />} title="Повторить (Ctrl+Y)" disabled={disabled} onClick={onRedo} />

      {divider}

      <ToolbarButton
        label="Ж"
        title="Полужирный (Ctrl+B)"
        className="font-bold"
        disabled={disabled}
        active={!!style.bold}
        onClick={() => onStyle({ bold: style.bold ? undefined : true })}
      />
      <ToolbarButton
        label="К"
        title="Курсив (Ctrl+I)"
        className="italic"
        disabled={disabled}
        active={!!style.italic}
        onClick={() => onStyle({ italic: style.italic ? undefined : true })}
      />
      <ToolbarButton
        label="Ч"
        title="Подчёркнутый (Ctrl+U)"
        className="underline"
        disabled={disabled}
        active={!!style.underline}
        onClick={() => onStyle({ underline: style.underline ? undefined : true })}
      />

      <input
        type="color"
        aria-label="Цвет текста"
        disabled={disabled}
        value={style.color ?? '#131a24'}
        onChange={(event) => onStyle({ color: event.target.value })}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-hairline bg-surface disabled:opacity-40 sm:h-8 sm:w-8"
      />
      <input
        type="color"
        aria-label="Цвет заливки"
        disabled={disabled}
        value={style.background ?? '#ffffff'}
        onChange={(event) => onStyle({ background: event.target.value })}
        className="h-9 w-9 shrink-0 cursor-pointer rounded border border-hairline bg-surface disabled:opacity-40 sm:h-8 sm:w-8"
      />
      <ToolbarButton
        label={<EraserIcon size={17} />}
        title="Убрать оформление"
        disabled={disabled}
        onClick={() =>
          onStyle({
            bold: undefined,
            italic: undefined,
            underline: undefined,
            color: undefined,
            background: undefined,
            align: undefined,
            format: undefined,
          })
        }
      />

      {divider}

      {/* Журнал часто заполняют раньше, чем заводят справочник маршрутов:
          эта кнопка проставляет сроки задним числом, там где они пусты. */}
      <ToolbarButton
        label={<RouteIcon size={17} />}
        title="Посчитать сроки прибытия по справочнику"
        disabled={disabled}
        onClick={onFillArrivals}
      />

      {/* Приёмка — второе по частоте действие после добавления: машина
          приехала, и это надо отметить в одно нажатие, а не набирать
          статус, имя и время по трём ячейкам. */}
      <button
        type="button"
        disabled={disabled}
        onClick={onArrived}
        title="Отметить прибытие машины в текущей строке"
        className={[
          'flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5',
          'text-sm text-ink hover:bg-surface-muted disabled:opacity-40',
        ].join(' ')}
      >
        <CheckIcon size={16} />
        Прибыл
      </button>

      {/* Кнопка со словом, а не значком: это главный способ добавить запись,
          и искать её среди одинаковых значков человек не должен. */}
      <button
        type="button"
        disabled={disabled}
        onClick={onAddRow}
        title="Добавить запись формой"
        className={[
          'flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5',
          'text-sm font-medium text-white hover:opacity-90 disabled:opacity-40',
        ].join(' ')}
      >
        <PlusIcon size={16} />
        Запись
      </button>

      {divider}

      {align('left', <AlignLeftIcon size={17} />, 'По левому краю')}
      {align('center', <AlignCenterIcon size={17} />, 'По центру')}
      {align('right', <AlignRightIcon size={17} />, 'По правому краю')}

      {divider}

      <span className="shrink-0">
      <Select
        label="Формат чисел"
        value={style.format ?? 'auto'}
        options={FORMATS}
        disabled={disabled}
        onChange={(format) => onStyle({ format: format as NumberFormat })}
      />
      </span>

      {divider}

      {/* Статусы: цвет ячейка берёт по слову, поэтому кнопка просто вписывает
          слово, а не красит. Так же покрасится и то, что человек набрал сам. */}
      <span className="shrink-0">
      <Select
        label="Статус"
        value=""
        options={[
          { value: '', label: 'Статус…' },
          ...STATUS_TONES.map((tone) => ({ value: tone.label, label: tone.label })),
        ]}
        disabled={disabled}
        onChange={(value) => value && onFill(value)}
      />
      </span>

      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />

      <ToolbarButton
        label={<RowIcon size={17} />}
        title="Вставить строку выше"
        disabled={disabled}
        onClick={onInsertRow}
      />
      <ToolbarButton
        label={<RowIcon size={17} minus />}
        title="Удалить строку"
        className="text-red-600"
        disabled={disabled}
        onClick={onDeleteRow}
      />
      <ToolbarButton
        label={<ColumnIcon size={17} />}
        title="Вставить столбец слева"
        disabled={disabled}
        onClick={onInsertCol}
      />
      <ToolbarButton
        label={<ColumnIcon size={17} minus />}
        title="Удалить столбец"
        className="text-red-600"
        disabled={disabled}
        onClick={onDeleteCol}
      />

      {divider}

      {/* Поиск доступен и при просмотре: смотреть чужую таблицу, не имея
          права её править, — обычное дело. */}
      <ToolbarButton
        label={<PinIcon size={17} />}
        title={headerFrozen ? 'Открепить шапку' : 'Закрепить шапку'}
        active={headerFrozen}
        disabled={disabled}
        onClick={onToggleFreeze}
      />
      <ToolbarButton
        label={<UploadIcon size={17} />}
        title="Загрузить из Excel или CSV (можно перетащить файл на таблицу)"
        disabled={disabled}
        onClick={onImport}
      />
      <ToolbarButton
        label={<ChartIcon size={17} />}
        title="Диаграммы"
        onClick={onCharts}
      />

      <ToolbarButton
        label={<SearchIcon size={17} />}
        title="Найти и заменить (Ctrl+F)"
        onClick={onFind}
      />
    </div>
  )
}
