/**
 * Меню по правой кнопке на ячейке или номере строки.
 *
 * Удаление строки раньше было только безымянным значком на панели: заказчик
 * его попросту не нашёл и решил, что машину удалить нельзя. Правая кнопка —
 * первое, что пробуют в любой таблице, поэтому действия со строкой живут здесь.
 * На телефоне то же меню открывается долгим нажатием.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { MenuItem } from '@/components/Menu'

type Props = {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

const EDGE = 8

export function RowMenu({ x, y, items, onClose }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })

  // У края экрана меню раскрывается внутрь: иначе нижние пункты уезжали бы
  // за пределы окна.
  useLayoutEffect(() => {
    const box = list.current?.getBoundingClientRect()
    if (!box) return
    setPosition({
      left: Math.max(EDGE, Math.min(x, window.innerWidth - box.width - EDGE)),
      top: Math.max(EDGE, Math.min(y, window.innerHeight - box.height - EDGE)),
    })
  }, [x, y])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const buttons = Array.from(list.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
      const at = buttons.indexOf(document.activeElement as HTMLElement)
      const next = event.key === 'ArrowDown' ? at + 1 : at - 1
      buttons[(next + buttons.length) % buttons.length]?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', onClose)
    list.current?.querySelector<HTMLElement>('button:not([disabled])')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div
      ref={list}
      role="menu"
      aria-label="Действия со строкой"
      style={position}
      className={[
        'animate-pop fixed z-50 min-w-56 rounded-2xl border border-hairline',
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
            onClose()
            item.onSelect()
          }}
          className={[
            'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-surface-muted',
            'disabled:cursor-not-allowed disabled:opacity-40',
            item.danger ? 'text-red-600' : 'text-ink',
          ].join(' ')}
        >
          {item.icon ? <span className="text-ink-muted">{item.icon}</span> : <span className="w-4" />}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
