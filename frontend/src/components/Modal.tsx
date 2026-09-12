/**
 * Модальное окно.
 *
 * Фокус на время показа заперт внутри окна: пользователю с клавиатуры нельзя
 * уйти табуляцией на страницу под ним — он не увидел бы, куда попал фокус.
 */
import { useCallback, useEffect, useRef } from 'react'
import { CloseIcon } from './icons'

type Props = {
  title: string
  onClose: () => void
  children: React.ReactNode
  footer?: React.ReactNode
  width?: 'sm' | 'md' | 'lg'
}

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, children, footer, width = 'md' }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  // Куда вернуть фокус после закрытия — иначе он улетает в начало страницы.
  const opener = useRef<Element | null>(null)

  useEffect(() => {
    opener.current = document.activeElement
    dialog.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    return () => {
      ;(opener.current as HTMLElement | null)?.focus?.()
    }
  }, [])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
      if (items.length === 0) return

      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    },
    [onClose],
  )

  return (
    <div
      className="animate-fade fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        // Закрывает только клик по подложке. Проверка именно на цель события:
        // иначе окно схлопывалось бы при отпускании мыши после выделения текста.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={handleKeyDown}
        className={[
          'flex max-h-[90dvh] w-full flex-col rounded-t-xl bg-surface shadow-xl sm:rounded-xl',
          'animate-rise sm:animate-pop',
          WIDTHS[width],
        ].join(' ')}
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-3">
          <h2 className="flex-1 text-base font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-full p-1.5 text-ink-muted hover:bg-surface-muted"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <div className="border-t border-hairline px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}
