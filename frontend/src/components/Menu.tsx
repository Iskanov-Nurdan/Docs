/**
 * Выпадающее меню.
 *
 * Закрывается по клику вне, по Escape и после выбора пункта. Фокус при
 * открытии уходит на первый пункт: иначе с клавиатуры меню невозможно пройти.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAnchoredPosition } from './anchored'

export type MenuItem = {
  label: string
  onSelect: () => void
  /** Значок слева от подписи. Необязателен: не у всякого действия он есть. */
  icon?: React.ReactNode
  danger?: boolean
  disabled?: boolean
}

type Props = {
  label: string
  items: MenuItem[]
  /** Подпись кнопки, если она не совпадает с названием меню (символ, счётчик). */
  trigger?: React.ReactNode
  align?: 'left' | 'right'
  className?: string
}

export function Menu({ label, items, trigger, align = 'right', className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  // Меню рисуется в конце страницы: в списке документов и в панели таблицы
  // оно лежит внутри полосы с прокруткой, которая обрезала бы его по краю.
  const position = useAnchoredPosition(root, open, align, false)
  const id = useId()

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || list.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    list.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
        className={className || 'rounded-full p-1.5 text-ink-muted hover:bg-surface-muted'}
      >
        {trigger ?? label}
      </button>

      {open && createPortal(
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          style={position}
          className={[
            'animate-pop min-w-48 overflow-y-auto overscroll-contain rounded-2xl border border-hairline',
            'bg-surface py-1 shadow-lg',
          ].join(' ')}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false)
                item.onSelect()
              }}
              className={[
                'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-muted',
                'disabled:cursor-not-allowed disabled:opacity-40',
                item.danger ? 'text-red-600' : 'text-ink',
              ].join(' ')}
            >
              {item.icon ? (
                <span className="text-ink-muted">{item.icon}</span>
              ) : (
                // Пустое место держит подписи в одной колонке, даже если
                // значок есть не у каждого пункта.
                <span className="w-4" />
              )}
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
