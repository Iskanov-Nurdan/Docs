/** Кнопка панелей редактора: одна форма для основной панели и панели таблицы. */
import type { ReactNode } from 'react'

type Props = {
  label: ReactNode
  /** Идёт и в подсказку, и в имя для чтения с экрана: подпись кнопки — значок. */
  title: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  className?: string
}

export function ToolbarButton({
  label,
  title,
  onClick,
  active = false,
  disabled = false,
  className = '',
}: Props) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        // На телефоне кнопка выше: в 32 пикселя палец попадает через раз,
        // а панель там прокручивается вбок и лишнюю высоту не забирает.
        // shrink-0 — чтобы в этой прокрутке кнопки не сплющивались.
        'flex h-9 min-w-9 shrink-0 items-center justify-center rounded-full px-2 text-sm transition-colors sm:h-8 sm:min-w-8',
        'hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed',
        active ? 'bg-accent/10 font-semibold text-accent' : '',
        className,
      ].join(' ')}
    >
      {label}
    </button>
  )
}
