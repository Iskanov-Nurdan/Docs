/**
 * Поиск и замена по книге: Ctrl+F.
 *
 * Ищет по мере ввода — по номеру счёта, артикулу, части названия. Найденные
 * ячейки подсвечиваются все сразу, а Enter и стрелки ведут по ним по очереди:
 * в накладной на триста строк один номер встречается несколько раз, и нужно
 * увидеть каждое место, а не только первое.
 *
 * Заменяется введённый текст, а не показанный. Совпадение в результате
 * формулы найдётся и подсветится, но заменить его нельзя: подмена держалась бы
 * до первого пересчёта. Такие ячейки при замене пропускаются, и об этом
 * сказано прямо в панели.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type * as Y from 'yjs'
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, SearchIcon } from '@/components/icons'
import { cellRef } from './formula'
import {
  type CellHit,
  type FindOptions,
  type SheetInfo,
  type SheetMap,
  findCells,
  findInBook,
  replaceInCell,
  sheetAt,
} from './model'

type Props = {
  doc: Y.Doc
  sheet: SheetMap
  sheetIndex: number
  sheets: SheetInfo[]
  /** Меняется на каждую правку книги — повод пересчитать совпадения. */
  version: number
  editable: boolean
  /** Как ячейка выглядит на экране: по показанному тоже ищем. */
  displayFor: (sheetIndex: number) => (row: number, col: number) => string
  onGo: (hit: CellHit) => void
  onMatchesChange: (hits: CellHit[]) => void
  onClose: () => void
}

export function SheetFind({
  doc,
  sheet,
  sheetIndex,
  sheets,
  version,
  editable,
  displayFor,
  onGo,
  onMatchesChange,
  onClose,
}: Props) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [matchCase, setMatchCase] = useState(false)
  const [wholeCell, setWholeCell] = useState(false)
  const [allSheets, setAllSheets] = useState(false)
  const [current, setCurrent] = useState(0)
  const [note, setNote] = useState('')

  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])

  const options: FindOptions = { matchCase, wholeCell }

  const hits = useMemo(
    () =>
      allSheets
        ? findInBook(doc, query, displayFor, options)
        : findCells(sheet, query, displayFor(sheetIndex), options).map((hit) => ({
            ...hit,
            sheet: sheetIndex,
          })),
    // displayFor пересоздаётся вместе с пересчётом значений, поэтому в
    // зависимостях достаточно версии книги.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc, sheet, sheetIndex, query, version, matchCase, wholeCell, allSheets],
  )

  // Подсвечивать можно только то, что на экране, — совпадения с других листов
  // сетке не принадлежат.
  const onCurrentSheet = useMemo(
    () => hits.filter((hit) => hit.sheet === sheetIndex),
    [hits, sheetIndex],
  )

  useEffect(() => {
    onMatchesChange(onCurrentSheet)
  }, [onCurrentSheet, onMatchesChange])

  // Список совпадений поменялся — начинаем с первого, иначе указатель
  // «5 из 3» пережил бы правку таблицы.
  useEffect(() => {
    setCurrent(0)
    setNote('')
  }, [query, matchCase, wholeCell, allSheets])

  const activeHit = hits.length ? hits[Math.min(current, hits.length - 1)] : null

  useEffect(() => {
    if (activeHit) onGo(activeHit)
    // Переход выполняется на смену указателя, а не на каждый ререндер.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, hits])

  const step = (delta: number) => {
    if (hits.length === 0) return
    setNote('')
    setCurrent((value) => (value + delta + hits.length) % hits.length)
  }

  const close = () => {
    onMatchesChange([])
    onClose()
  }

  const replaceCurrent = () => {
    if (!activeHit || !editable) return

    if (!activeHit.inRaw) {
      setNote('Здесь совпал результат формулы — заменить можно только формулу')
      return
    }

    const target = sheetAt(doc, activeHit.sheet ?? sheetIndex)
    if (!target) return

    replaceInCell(doc, target, activeHit.row, activeHit.col, query, replacement, options)
    setNote('')
    // На месте заменённого совпадения список сдвинется сам, поэтому указатель
    // не двигаем: следующим окажется как раз следующее совпадение.
  }

  const replaceAll = () => {
    if (!editable || hits.length === 0) return

    const replaceable = hits.filter((hit) => hit.inRaw)
    const skipped = hits.length - replaceable.length

    let done = 0
    doc.transact(() => {
      for (const hit of replaceable) {
        const target = sheetAt(doc, hit.sheet ?? sheetIndex)
        if (!target) continue
        if (replaceInCell(doc, target, hit.row, hit.col, query, replacement, options)) done += 1
      }
    })

    setNote(
      skipped > 0
        ? `Заменено: ${done}. Пропущено формул: ${skipped}`
        : `Заменено: ${done}`,
    )
  }

  const checkbox = (
    id: string,
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void,
  ) => (
    <label htmlFor={id} className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3.5 w-3.5 accent-accent"
      />
      {label}
    </label>
  )

  const position = activeHit
    ? `${Math.min(current + 1, hits.length)} из ${hits.length} · ${
        allSheets && sheets[activeHit.sheet ?? 0]
          ? `${sheets[activeHit.sheet ?? 0].name}!`
          : ''
      }${cellRef(activeHit.row, activeHit.col)}`
    : ''

  return (
    <div className="border-b border-hairline bg-surface px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0 text-ink-muted">
            <SearchIcon size={16} />
          </span>
          <input
            ref={input}
            value={query}
            aria-label="Что искать"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                step(event.shiftKey ? -1 : 1)
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                close()
              }
            }}
            placeholder="Номер, артикул или часть текста"
            className="min-w-0 flex-1 rounded-full border border-hairline bg-surface px-3.5 py-1 text-sm text-ink outline-none transition-colors focus:border-accent"
          />
        </label>

        <span
          className="shrink-0 text-sm tabular-nums text-ink-muted"
          role="status"
          aria-live="polite"
        >
          {query === '' ? ' ' : hits.length === 0 ? 'Ничего не найдено' : position}
        </span>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={hits.length === 0}
            aria-label="Предыдущее совпадение"
            className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted disabled:opacity-40"
          >
            <ChevronUpIcon size={16} />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={hits.length === 0}
            aria-label="Следующее совпадение"
            className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted disabled:opacity-40"
          >
            <ChevronDownIcon size={16} />
          </button>

          {editable && (
            <button
              type="button"
              onClick={() => setReplacing((value) => !value)}
              aria-expanded={replacing}
              className={[
                'rounded-full px-3 py-1 text-xs transition-colors',
                replacing ? 'bg-surface-muted text-ink' : 'text-ink-muted hover:bg-surface-muted',
              ].join(' ')}
            >
              Заменить
            </button>
          )}

          <button
            type="button"
            onClick={close}
            aria-label="Закрыть поиск"
            className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-surface-muted"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {checkbox('find-case', 'Учитывать регистр', matchCase, setMatchCase)}
        {checkbox('find-whole', 'Ячейка целиком', wholeCell, setWholeCell)}
        {sheets.length > 1 && checkbox('find-all', 'Все листы', allSheets, setAllSheets)}

        {note && (
          <span className="text-xs text-ink-muted" role="status" aria-live="polite">
            {note}
          </span>
        )}
      </div>

      {replacing && editable && (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <label htmlFor="find-replacement" className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 text-xs text-ink-muted">На что</span>
            <input
              id="find-replacement"
              value={replacement}
              onChange={(event) => setReplacement(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  replaceCurrent()
                }
                if (event.key === 'Escape') close()
              }}
              placeholder="Новое значение"
              className="min-w-0 flex-1 rounded-full border border-hairline bg-surface px-3.5 py-1 text-sm text-ink outline-none transition-colors focus:border-accent"
            />
          </label>

          <button
            type="button"
            onClick={replaceCurrent}
            disabled={!activeHit}
            className="shrink-0 rounded-full border border-hairline px-3 py-1 text-xs hover:bg-surface-muted disabled:opacity-40"
          >
            Заменить
          </button>
          <button
            type="button"
            onClick={replaceAll}
            disabled={hits.length === 0}
            className="shrink-0 rounded-full bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            Заменить все
          </button>
        </div>
      )}
    </div>
  )
}
