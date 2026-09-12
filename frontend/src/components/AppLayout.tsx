/**
 * Каркас страниц вне редактора: шапка с поиском и боковая навигация.
 *
 * На узком экране боковая панель выезжает поверх содержимого: рядом с
 * списком документов она не помещается, а прятать её насовсем нельзя —
 * иначе до папок и корзины с телефона не добраться.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useSearchParams } from 'react-router-dom'
import { FolderTree } from './FolderTree'
import { InputDialog } from './InputDialog'
import { Menu } from './Menu'
import { NotificationsMenu } from './NotificationsMenu'
import {
  CloseIcon,
  LogoutIcon,
  MenuIcon,
  PlusIcon,
  UploadIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SheetIcon,
  StarIcon,
  TemplateIcon,
  TrashIcon,
  UsersIcon,
} from './icons'
import { ApiError, api } from '@/api'
import { useAuth } from '@/store/auth'
import { useFolders } from '@/store/folders'

const SECTIONS = [
  { to: '/documents', label: 'Мои документы', Icon: SheetIcon },
  { to: '/shared', label: 'Доступные мне', Icon: UsersIcon },
  { to: '/starred', label: 'Избранное', Icon: StarIcon },
  { to: '/templates', label: 'Шаблоны', Icon: TemplateIcon },
  { to: '/trash', label: 'Корзина', Icon: TrashIcon },
]

type Props = {
  title: string
  /** Кнопки, относящиеся к самой странице: импорт, вид списка и прочее. */
  actions?: React.ReactNode
  children: React.ReactNode
}

export function AppLayout({ title, actions, children }: Props) {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { load: loadFolders, create: createFolder } = useFolders()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get('q') ?? '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [newFolder, setNewFolder] = useState(false)
  // Перенос таблицы из файла: пока идёт разбор и пока есть что сказать об
  // ошибке. Разбор нескольких тысяч строк занимает секунды, и без признака
  // работы человек жмёт кнопку второй раз.
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const filePicker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    loadFolders()
  }, [loadFolders])

  // Строка поиска — часть адреса: результат можно послать ссылкой,
  // а «Назад» возвращает к прежнему запросу.
  useEffect(() => {
    setQuery(params.get('q') ?? '')
  }, [params])

  const goToSearch = (value: string, replace: boolean) => {
    const trimmed = value.trim()
    navigate(trimmed ? `/documents?q=${encodeURIComponent(trimmed)}` : '/documents', { replace })
  }

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault()
    // Enter добавляет запрос в историю — по нему можно вернуться «Назад».
    goToSearch(query, false)
  }

  // Результат обновляется по мере набора: искать номер счёта проще, когда
  // список сужается на глазах. Задержка не даёт слать запрос на каждую букву,
  // а замена записи в истории — засорять её каждым нажатием.
  useEffect(() => {
    if (query === (params.get('q') ?? '')) return

    const timer = window.setTimeout(() => goToSearch(query, true), 300)
    return () => window.clearTimeout(timer)
    // navigate и params стабильны в пределах страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Переход из другого раздела перерисовывает шапку, и фокус ушёл бы из поля
  // на середине слова. Возвращаем его вместе с курсором в конец строки.
  useEffect(() => {
    if (!params.get('q')) return
    const input = search.current
    if (!input || document.activeElement === input) return
    input.focus()
    input.setSelectionRange(input.value.length, input.value.length)
    // Только при появлении поля с непустым запросом.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const createDocument = async () => {
    const document = await api.createDocument({ title: 'Новая таблица' })
    navigate(`/documents/${document.id}`)
  }

  const importDocument = async (file: File) => {
    setImporting(true)
    setImportError('')
    try {
      const document = await api.importDocument(file)
      navigate(`/documents/${document.id}`)
    } catch (error) {
      setImportError(
        error instanceof ApiError ? error.message : 'Не удалось открыть файл',
      )
    } finally {
      setImporting(false)
      // Сбрасываем выбор: иначе тот же файл вторым разом не выберется —
      // значение поля не меняется, и события не будет.
      if (filePicker.current) filePicker.current.value = ''
    }
  }

  const navigation = (
    <nav aria-label="Разделы" className="flex flex-col gap-4">
      <ul className="space-y-0.5">
        {SECTIONS.map((section) => (
          <li key={section.to}>
            <NavLink
              to={section.to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                [
                  'flex items-center gap-2 rounded px-2 py-2 text-sm',
                  isActive ? 'bg-accent/10 font-medium text-accent' : 'text-ink hover:bg-surface-muted',
                ].join(' ')
              }
            >
              <section.Icon />
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div>
        <div className="mb-1 flex items-center gap-1 px-2">
          <h2 className="flex-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Папки
          </h2>
          <button
            type="button"
            onClick={() => setNewFolder(true)}
            aria-label="Создать папку"
            className="rounded-full p-1 text-ink-muted hover:bg-surface-muted hover:text-accent"
          >
            <PlusIcon size={16} />
          </button>
        </div>
        <FolderTree onNavigate={() => setMenuOpen(false)} />
      </div>
    </nav>
  )

  return (
    <div className="min-h-dvh bg-surface-muted">
      <header className="sticky top-0 z-20 border-b border-hairline bg-surface">
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Открыть меню"
            className="rounded-full border border-hairline p-2 text-ink-muted hover:bg-surface-muted lg:hidden"
          >
            <MenuIcon />
          </button>

          <Link to="/documents" className="text-lg font-semibold text-ink">
            ALI<span className="text-accent"> trade</span>
          </Link>

          <form onSubmit={submitSearch} className="order-3 w-full sm:order-none sm:w-auto sm:flex-1">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
                <SearchIcon size={16} />
              </span>
              <input
                ref={search}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по названию и содержимому"
                aria-label="Поиск документов"
                className="w-full rounded-full border border-hairline bg-surface-muted py-2 pl-10 pr-4 text-sm outline-none focus:border-accent"
              />
            </div>
          </form>

          {/* Открыть готовый файл — действие редкое рядом с «создать»,
              поэтому значком: подпись отнимала бы место в шапке у поиска. */}
          <input
            ref={filePicker}
            type="file"
            accept=".xlsx,.xlsm,.csv"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importDocument(file)
            }}
          />
          <button
            type="button"
            onClick={() => filePicker.current?.click()}
            disabled={importing}
            title="Открыть файл Excel или CSV"
            aria-label="Открыть файл Excel или CSV"
            className="rounded-full border border-hairline p-2 text-ink-muted hover:bg-surface-muted disabled:opacity-50"
          >
            <UploadIcon size={16} />
          </button>

          {/* Создаётся одно — таблица, поэтому кнопка, а не меню с одним пунктом. */}
          <button
            type="button"
            onClick={() => void createDocument()}
            className="flex items-center gap-1.5 rounded-full bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90 sm:px-4"
          >
            <PlusIcon size={16} />
            {importing ? 'Открываем…' : 'Создать таблицу'}
          </button>

          <NotificationsMenu />

          <Menu
            label="Меню пользователя"
            trigger={
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">
                {user?.initials ?? user?.display_name?.slice(0, 2).toUpperCase() ?? '—'}
              </span>
            }
            className="rounded-full"
            items={[
              ...(user?.is_staff
                ? [
                    {
                      label: 'Администрирование',
                      icon: <ShieldIcon size={16} />,
                      onSelect: () => navigate('/admin'),
                    },
                  ]
                : []),
              { label: 'Настройки', icon: <SettingsIcon size={16} />, onSelect: () => navigate('/settings') },
              {
                label: 'Выйти',
                icon: <LogoutIcon size={16} />,
                onSelect: () => logout().then(() => navigate('/login')),
              },
            ]}
          />
        </div>
      </header>

      {importError && (
        <div
          role="alert"
          className="flex items-center gap-3 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          <span className="flex-1">{importError}</span>
          <button
            type="button"
            onClick={() => setImportError('')}
            className="shrink-0 rounded-full p-1 hover:bg-red-100"
            aria-label="Закрыть сообщение"
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      <div className="flex">
        <aside className="sticky top-[57px] hidden h-[calc(100dvh-57px)] w-64 shrink-0 overflow-y-auto border-r border-hairline bg-surface px-3 py-4 lg:block">
          {navigation}
        </aside>

        {menuOpen && (
          <div
            className="animate-fade fixed inset-0 z-30 bg-black/40 lg:hidden"
            onClick={() => setMenuOpen(false)}
          >
            <aside
              role="dialog"
              aria-label="Разделы"
              onClick={(event) => event.stopPropagation()}
              className="animate-slide h-full w-72 max-w-[85vw] overflow-y-auto bg-surface px-3 py-4"
            >
              <div className="mb-3 flex items-center">
                <h2 className="flex-1 font-semibold text-ink">Меню</h2>
                <button
                  type="button"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Закрыть меню"
                  className="rounded-full p-1.5 text-ink-muted hover:bg-surface-muted"
                >
                  <CloseIcon />
                </button>
              </div>
              {navigation}
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1 px-4 py-5">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h1 className="flex-1 text-xl font-semibold text-ink">{title}</h1>
            {actions}
          </div>
          {children}
        </main>
      </div>

      {newFolder && (
        <InputDialog
          title="Новая папка"
          label="Название"
          submitLabel="Создать"
          placeholder="Например, Договоры"
          onSubmit={(value) => createFolder(value).then(() => undefined)}
          onClose={() => setNewFolder(false)}
        />
      )}
    </div>
  )
}
