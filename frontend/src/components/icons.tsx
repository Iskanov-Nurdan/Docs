/**
 * Значки интерфейса.
 *
 * Рисуются здесь, а не берутся библиотекой: набор нужен небольшой, а своя
 * отрисовка держит один стиль — контур толщиной 1,5, скруглённые концы,
 * сетка 24×24. Библиотека ради двадцати значков утянула бы сотни.
 *
 * Цвет всегда наследуется от текста (`currentColor`), поэтому значок сам
 * подстраивается под тему и под состояние кнопки. Размер задаётся пропсом
 * `size`, по умолчанию 18 — под строку интерфейса.
 *
 * Значок — украшение рядом с подписью, поэтому он скрыт от чтения с экрана
 * (`aria-hidden`). Там, где кнопка состоит из одного значка, подпись даётся
 * атрибутом `aria-label` на самой кнопке.
 */
type IconProps = {
  size?: number
  className?: string
}

function Icon({
  size = 18,
  className = '',
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  )
}

export function SheetIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14.5h18M9 4v16M15 4v16" />
    </Icon>
  )
}

export function UsersIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15.5 20v-1.5a3.5 3.5 0 0 0-3.5-3.5H7a3.5 3.5 0 0 0-3.5 3.5V20" />
      <circle cx="9.5" cy="8" r="3.2" />
      <path d="M20.5 20v-1.5a3.5 3.5 0 0 0-2.6-3.4M16 5a3.2 3.2 0 0 1 0 6" />
    </Icon>
  )
}

export function StarIcon({ filled = false, ...props }: IconProps & { filled?: boolean }) {
  return (
    <Icon {...props}>
      <path
        d="m12 4 2.4 5 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.8 9.6 9 12 4Z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </Icon>
  )
}

export function FolderIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 3 17.5v-10Z" />
    </Icon>
  )
}

export function TrashIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7" />
      <path d="M6.5 7 7.4 19a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
      <path d="M10.5 11v5.5M13.5 11v5.5" />
    </Icon>
  )
}

export function TemplateIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M9 9v11" />
    </Icon>
  )
}

export function BellIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 15.5V11a6 6 0 1 0-12 0v4.5L4.5 18h15L18 15.5Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </Icon>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  )
}

export function SearchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
    </Icon>
  )
}

export function MoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="5.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.3" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m9.5 6 6 6-6 6" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Icon>
  )
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 14.5 6-6 6 6" />
    </Icon>
  )
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  )
}

export function GridViewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.4" />
      <rect x="13" y="4" width="7" height="7" rx="1.4" />
      <rect x="4" y="13" width="7" height="7" rx="1.4" />
      <rect x="13" y="13" width="7" height="7" rx="1.4" />
    </Icon>
  )
}

export function ListViewIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="4" cy="7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="12" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="4" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 16V4m0 0L8 8m4-4 4 4" />
      <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </Icon>
  )
}

export function PinIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 10h16" />
      <path d="M8 14v6m8-6v6M4 14h16" strokeOpacity="0.45" />
    </Icon>
  )
}

export function ChartIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="0.5" />
      <rect x="12" y="8" width="3" height="9" rx="0.5" />
      <rect x="17" y="5" width="3" height="12" rx="0.5" />
    </Icon>
  )
}

export function RouteIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="6" r="2.5" />
      <path d="M8.5 18h5a4 4 0 0 0 0-8h-3a4 4 0 0 1 0-8h5" strokeDasharray="0" />
    </Icon>
  )
}

export function DownloadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v11M8 11.5l4 4 4-4M5 19.5h14" />
    </Icon>
  )
}

export function HistoryIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12a8 8 0 1 0 2.5-5.8M4 5.5V10h4.5" />
      <path d="M12 8v4.4l3 1.8" />
    </Icon>
  )
}

export function ShareIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="17.5" cy="6" r="2.5" />
      <circle cx="6.5" cy="12" r="2.5" />
      <circle cx="17.5" cy="18" r="2.5" />
      <path d="m8.8 10.8 6.4-3.5M8.8 13.2l6.4 3.5" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a1.9 1.9 0 1 1-2.7 2.7l-.1-.1a1.6 1.6 0 0 0-2.7 1.1v.3a1.9 1.9 0 1 1-3.8 0v-.2a1.6 1.6 0 0 0-2.8-1.1l-.1.1a1.9 1.9 0 1 1-2.7-2.7l.1-.1a1.6 1.6 0 0 0-1.1-2.7h-.3a1.9 1.9 0 1 1 0-3.8h.2a1.6 1.6 0 0 0 1.1-2.8l-.1-.1a1.9 1.9 0 1 1 2.7-2.7l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5v-.3a1.9 1.9 0 1 1 3.8 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a1.9 1.9 0 1 1 2.7 2.7l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.3a1.9 1.9 0 1 1 0 3.8h-.2a1.6 1.6 0 0 0-1.5 1Z" />
    </Icon>
  )
}

export function LogoutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2-2v-2" />
      <path d="M19.5 12H9.5M16.5 8.5l3 3.5-3 3.5" />
    </Icon>
  )
}

export function RestoreIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 12a8 8 0 1 0 2.5-5.8M4 5.5V10h4.5" />
    </Icon>
  )
}

export function CopyIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15" />
    </Icon>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9h10a5 5 0 0 1 0 10H8M4 9l4-4M4 9l4 4" />
    </Icon>
  )
}

export function RedoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 9H10a5 5 0 0 0 0 10h6M20 9l-4-4M20 9l-4 4" />
    </Icon>
  )
}

export function AlignLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 10.5h10M4 15h16M4 19.5h10" />
    </Icon>
  )
}

export function AlignCenterIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M7 10.5h10M4 15h16M7 19.5h10" />
    </Icon>
  )
}

export function AlignRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M10 10.5h10M4 15h16M10 19.5h10" />
    </Icon>
  )
}

export function EraserIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M8.5 19.5H20M4.8 15.8l3.4 3.4a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8l-3.4-3.4a2 2 0 0 0-2.8 0L4.8 13a2 2 0 0 0 0 2.8Z" />
      <path d="m10.5 8.5 5 5" />
    </Icon>
  )
}

/** Строка таблицы: подсвечена одна полоса поперёк. */
export function RowIcon({ minus = false, ...props }: IconProps & { minus?: boolean }) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M3 14.5h18" />
      <rect x="3.2" y="10" width="17.6" height="4.5" fill="currentColor" stroke="none" opacity="0.18" />
      {minus ? <path d="M9 12.2h6" /> : <path d="M12 9.5v5.5M9.2 12.2h5.6" />}
    </Icon>
  )
}

/** Столбец таблицы: подсвечена одна полоса вдоль. */
export function ColumnIcon({ minus = false, ...props }: IconProps & { minus?: boolean }) {
  return (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M9 5v14M15 5v14" />
      <rect x="9" y="5.2" width="6" height="13.6" fill="currentColor" stroke="none" opacity="0.18" />
      {minus ? <path d="M9.8 12h4.4" /> : <path d="M12 9.2v5.6M9.8 12h4.4" />}
    </Icon>
  )
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Icon>
  )
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5 5 6v5.5c0 4 2.9 7.6 7 9 4.1-1.4 7-5 7-9V6l-7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </Icon>
  )
}

export function UserBlockIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20v-1.2A4.3 4.3 0 0 1 7.8 14.5h3" />
      <circle cx="17" cy="17" r="4" />
      <path d="m14.2 19.8 5.6-5.6" />
    </Icon>
  )
}
