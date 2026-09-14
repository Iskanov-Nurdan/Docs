/**
 * Выпадающий список.
 *
 * Свой, а не `<select>`: системный список рисует операционная система, и его
 * нельзя ни скруглить, ни подсветить выбранное, ни поставить значок — на
 * телефоне он и вовсе разворачивается колесом снизу экрана.
 *
 * Клавиатура работает как в системном: стрелки водят по пунктам, Enter
 * выбирает, Escape закрывает, набор букв прыгает к совпадению. Без этого
 * замена системного элемента была бы шагом назад для тех, кто не пользуется
 * мышью.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from './anchored'
import { CheckIcon, ChevronDownIcon } from './icons'

export type SelectOption<T extends string> = {
  value: T
  label: string
  /** Пояснение под названием: чем эта роль отличается от соседней. */
  hint?: string
}

type Props<T extends string> = {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  /** Подпись для чтения с экрана: на месте поля её не видно. */
  label: string
  disabled?: boolean
  /** Во всю ширину — в формах; по содержимому — в панелях. */
  block?: boolean
  className?: string
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  disabled = false,
  block = false,
  className = '',
}: Props<T>) {
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Список рисуется в конце страницы, поэтому его положение считается от
  // кнопки. Внутри панели с прокруткой он иначе обрезался бы по её краю.
  const position = useAnchoredPosition(root, open)
  const search = useRef({ text: '', at: 0 })
  const id = useId()

  const selected = useMemo(
    () => options.find((option) => option.value === value) ?? options[0],
    [options, value],
  )

  useEffect(() => {
    if (!open) return

    setHighlighted(Math.max(0, options.findIndex((option) => option.value === value)))

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || list.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
    // Подсветка ставится на открытие, а не на каждую смену значения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  /**
   * Выбранный пункт должен быть виден сразу: в длинном списке он может
   * оказаться далеко внизу.
   *
   * Прокручиваем сам список, а не зовём scrollIntoView: список висит
   * отдельным слоем поверх страницы, и браузер, стараясь показать пункт,
   * уводил вниз всю страницу — форма под списком уезжала за край экрана.
   */
  useEffect(() => {
    if (!open) return
    const box = list.current
    const item = box?.querySelector<HTMLElement>('[data-highlighted="true"]')
    if (!box || !item) return

    const top = item.offsetTop
    const bottom = top + item.offsetHeight
    if (top < box.scrollTop) box.scrollTop = top
    else if (bottom > box.scrollTop + box.clientHeight) {
      box.scrollTop = bottom - box.clientHeight
    }
  }, [open, highlighted])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    onChange(option.value)
    setOpen(false)
  }

  /** Набор букв прыгает к пункту: «де» — к «Деньгам». */
  const jumpTo = (char: string) => {
    const now = Date.now()
    const text = now - search.current.at < 900 ? search.current.text + char : char
    search.current = { text, at: now }

    const found = options.findIndex((option) => option.label.toLowerCase().startsWith(text))
    if (found >= 0) {
      setHighlighted(found)
      if (!open) choose(found)
    }
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return

    if (event.key === 'Escape') {
      setOpen(false)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1

      if (!open) {
        // Закрытый список стрелками переключает значение — как системный.
        const next = Math.min(Math.max(options.findIndex((o) => o.value === value) + step, 0), options.length - 1)
        choose(next)
        return
      }
      setHighlighted((current) => (current + step + options.length) % options.length)
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      setHighlighted(event.key === 'Home' ? 0 : options.length - 1)
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(highlighted)
      else setOpen(true)
      return
    }

    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      jumpTo(event.key.toLowerCase())
    }
  }

  return (
    <div ref={root} className={`relative ${block ? 'w-full' : 'inline-block'}`}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
        className={[
          'flex items-center gap-2 rounded-full border bg-surface py-1.5 pl-3.5 pr-2.5 text-left text-sm',
          'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
          open ? 'border-accent' : 'border-hairline hover:bg-surface-muted',
          block ? 'w-full justify-between' : '',
          className,
        ].join(' ')}
      >
        <span className="truncate text-ink">{selected?.label ?? '—'}</span>
        <ChevronDownIcon
          size={15}
          className={`text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && createPortal(
        <div
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          onKeyDown={handleKeyDown}
          style={position}
          className={[
            'animate-pop overflow-y-auto overscroll-contain',
            'rounded-2xl border border-hairline bg-surface py-1 shadow-lg',
          ].join(' ')}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-highlighted={index === highlighted}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => choose(index)}
                className={[
                  'flex w-full items-start gap-2 px-3 py-2 text-left text-sm',
                  index === highlighted ? 'bg-surface-muted' : '',
                  isSelected ? 'font-medium text-accent' : 'text-ink',
                ].join(' ')}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{option.label}</span>
                  {option.hint && (
                    <span className="mt-0.5 block text-xs font-normal text-ink-muted">
                      {option.hint}
                    </span>
                  )}
                </span>

                {/* Галочка у выбранного: цветом одним отличие читается плохо. */}
                {isSelected && <CheckIcon size={15} className="mt-0.5" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </div>
  )
}
