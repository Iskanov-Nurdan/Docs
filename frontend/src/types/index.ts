/** Общие типы данных приложения. */

export type Paginated<T> = {
  count: number
  page: number
  pages: number
  page_size: number
  results: T[]
}

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer'

/** Ячейка в сохранённом снимке книги. */
export type SheetCellSnapshot = {
  /** Введённое человеком: «120» или «=СУММ(B2:B10)». */
  value: string
  /** Посчитанное значение в том виде, в каком его видно в таблице. */
  display?: string
}

export type SheetSnapshot = {
  id: string
  name: string
  /** Только заполненные ячейки: пустую сетку хранить незачем. */
  cells: Record<string, SheetCellSnapshot>
}

export type SheetContent = {
  kind: 'sheet'
  sheets: SheetSnapshot[]
}

/** Режим работы с документом. Определяет, что редактор разрешает делать. */
export type EditorMode = 'editing' | 'suggesting' | 'viewing'

export type User = {
  id: string
  email: string
  first_name: string
  last_name: string
  display_name: string
  initials?: string
  avatar: string | null
  cursor_color?: string
  language?: string
  theme?: 'light' | 'dark' | 'system'
  email_notifications?: boolean
  editor_settings?: Record<string, unknown>
  email_confirmed?: boolean
  /** Доступ в административную часть. */
  is_staff?: boolean
  /** Главный админ: назначает и снимает администраторов. */
  is_superuser?: boolean
  created_at?: string
}

/** Уровень прав в системе. Не путать с ролью в документе. */
export type AdminRole = 'owner' | 'admin' | 'member'

export type AdminUser = {
  id: number
  email: string
  display_name: string
  first_name: string
  last_name: string
  avatar: string | null
  role: AdminRole
  is_active: boolean
  is_staff: boolean
  is_superuser: boolean
  email_confirmed: boolean
  documents_count: number
  created_at: string
  last_login: string | null
}

export type AdminSummary = {
  users: number
  active_users: number
  admins: number
  documents: number
  trashed: number
}

export type Folder = {
  id: string
  name: string
  parent: string | null
  documents_count: number
  created_at: string
  updated_at: string
}

export type DocumentSummary = {
  id: string
  title: string
  owner: User
  folder: string | null
  preview: string
  /** Фрагмент вокруг найденного — приходит только в ответе на поиск. */
  snippet?: string
  is_starred: boolean
  is_published: boolean
  last_edited_by: User | null
  last_edited_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  my_role: Role | null
}

/** Сводка по книге: сколько листов, заполненных ячеек и формул. */
export type DocumentStats = {
  sheets: number
  cells: number
  formulas: number
  characters: number
}

export type Document = DocumentSummary & {
  content: Record<string, unknown>
  allow_download: boolean
  allow_copy: boolean
  allow_print: boolean
  stats: DocumentStats
}

/**
 * Курс доллара к сому.
 *
 * source говорит, откуда он: 'nbkr' — сегодняшний с сайта Нацбанка,
 * 'cache' — последний удачный, если сайт не ответил, 'unavailable' — курса
 * нет вовсе, и тогда rate равен null.
 */
export type UsdRate = {
  rate: number | null
  source: 'nbkr' | 'cache' | 'unavailable'
  date: string | null
}

/** Листы, разобранные сервером из файла Excel или CSV. */
export type ImportedBook = {
  /** Имя файла без расширения. */
  name: string
  kind: 'sheet'
  sheets: Array<{
    name: string
    cells: Record<string, { value: string; display: string }>
  }>
}

export type Permission = {
  id: number
  user: User
  role: Role
  role_display: string
  created_at?: string
}

export type ShareLink = {
  id: string
  token: string
  role: Role
  role_display: string
  access: 'restricted' | 'anyone'
  access_display: string
  expires_at: string | null
  is_active: boolean
}

export type Version = {
  id: string
  version_number: number
  user: User | null
  label: string
  metadata: Record<string, unknown>
  created_at: string
}

export type Template = {
  id: string
  title: string
  description: string
  category: string
  category_display: string
  preview_image: string | null
  is_building_block: boolean
  /** Заготовка, которую человек сохранил себе: видна только ему. */
  is_personal: boolean
}

export type Notification = {
  id: string
  type: string
  type_display: string
  actor: User | null
  document: string | null
  document_title: string
  comment: string | null
  message: string
  is_read: boolean
  created_at: string
}

/** Публикация документа в вебе. Пока не публиковали — приходит только published: false. */
export type Publication = {
  published: boolean
  id?: string
  public_id?: string
  title?: string
  is_active?: boolean
  auto_update?: boolean
  views_count?: number
  created_at?: string
  updated_at?: string
}

/** Участник, который сейчас в документе. */
export type Presence = {
  id: string
  name: string
  initials: string
  color: string
  avatar: string | null
}

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'syncing' | 'error'

/** Точка маршрута из общего справочника. */
export type Place = {
  id: string
  name: string
  /** Написание, приведённое к сравнимому виду: по нему ищется плечо. */
  key: string
  is_active: boolean
  order: number
}

/** Сумма транзита из общего справочника. Всегда в долларах. */
export type TransitAmount = {
  id: string
  /** Приходит строкой: сервер отдаёт десятичное число как «200.00». */
  amount: string
  note: string
  is_active: boolean
  order: number
}

/** Плечо маршрута: сколько часов от точки до точки. */
export type RouteLeg = {
  id: string
  origin: string
  destination: string
  origin_name: string
  destination_name: string
  origin_key: string
  destination_key: string
  hours: string
  note: string
}
