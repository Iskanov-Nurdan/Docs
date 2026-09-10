/** Общие типы данных приложения. */

export type Paginated<T> = {
  count: number
  page: number
  pages: number
  page_size: number
  results: T[]
}

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer'

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
  is_staff?: boolean
  created_at?: string
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
  is_starred: boolean
  is_published: boolean
  last_edited_by: User | null
  last_edited_at: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
  my_role: Role | null
}

export type Heading = { level: number; text: string; anchor: string }

export type DocumentStats = {
  characters: number
  characters_no_spaces: number
  words: number
  paragraphs: number
}

export type Document = DocumentSummary & {
  content: Record<string, unknown>
  document_mode: 'pages' | 'pageless'
  page_size: 'a4' | 'letter' | 'legal'
  orientation: 'portrait' | 'landscape'
  margin_top: number
  margin_bottom: number
  margin_left: number
  margin_right: number
  page_color: string
  allow_download: boolean
  allow_copy: boolean
  allow_print: boolean
  headings: Heading[]
  stats: DocumentStats
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

export type CommentReply = {
  id: string
  user: User
  content: string
  created_at: string
  updated_at: string
}

export type Comment = {
  id: string
  user: User
  content: string
  selection_data: Record<string, unknown>
  quoted_text: string
  is_resolved: boolean
  resolved_by: User | null
  resolved_at: string | null
  assignee: User | null
  is_completed: boolean
  replies: CommentReply[]
  reactions: { emoji: string; count: number }[]
  created_at: string
  updated_at: string
}

export type Suggestion = {
  id: string
  user: User
  operation: 'insert' | 'delete' | 'replace' | 'format'
  operation_display: string
  position: Record<string, unknown>
  content: Record<string, unknown>
  original_text: string
  suggested_text: string
  status: 'pending' | 'accepted' | 'rejected'
  status_display: string
  resolved_by: User | null
  resolved_at: string | null
  created_at: string
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

/** Участник, который сейчас в документе. */
export type Presence = {
  id: string
  name: string
  initials: string
  color: string
  avatar: string | null
}

export type SaveStatus = 'saved' | 'saving' | 'offline' | 'syncing' | 'error'
