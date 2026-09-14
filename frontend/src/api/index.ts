/** Методы API — по одному на конечную точку бэкенда. */
import { request, tokens } from './client'
import type {
  AdminSummary,
  AdminUser,
  Document,
  DocumentSummary,
  Folder,
  Notification,
  Paginated,
  Permission,
  Place,
  Publication,
  RouteLeg,
  ShareLink,
  Template,
  User,
  Version,
} from '@/types'

type AuthResponse = { user: User; access: string; refresh: string }

/** Папка меняется отдельным полем folder_id: сервер ждёт идентификатор, а не объект. */
type DocumentPatch = Partial<Omit<Document, 'folder'>> & { folder_id?: string | null }

export const api = {
  // --- Вход и учётная запись ---
  login: (body: { email: string; password: string }) =>
    request<AuthResponse>('/auth/login/', { method: 'POST', body }),
  logout: () => request<void>('/auth/logout/', { method: 'POST', body: { refresh: tokens.refresh } }),
  confirmEmail: (token: string) => request('/auth/confirm-email/', { method: 'POST', body: { token } }),
  requestPasswordReset: (email: string) =>
    request('/auth/password/reset/', { method: 'POST', body: { email } }),
  confirmPasswordReset: (body: { token: string; new_password: string }) =>
    request('/auth/password/reset/confirm/', { method: 'POST', body }),
  changePassword: (body: { current_password: string; new_password: string }) =>
    request('/auth/password/change/', { method: 'POST', body }),

  me: () => request<User>('/users/me/'),
  updateProfile: (body: Partial<User>) => request<User>('/users/me/', { method: 'PATCH', body }),
  uploadAvatar: (file: File) => {
    const formData = new FormData()
    formData.append('avatar', file)
    return request<User>('/users/me/', { method: 'PATCH', formData })
  },
  searchUsers: (q: string) => request<User[]>('/users/search/', { params: { q } }),

  // --- Администрирование ---
  adminUsers: (params: { q?: string; page?: number } = {}) =>
    request<Paginated<AdminUser>>('/admin/users/', { params }),
  adminSummary: () => request<AdminSummary>('/admin/summary/'),
  createUser: (body: {
    email: string
    password: string
    first_name?: string
    last_name?: string
    role?: 'member' | 'admin'
  }) => request<AdminUser>('/admin/users/', { method: 'POST', body }),
  updateAdminUser: (id: number, body: { role?: 'admin' | 'member'; is_active?: boolean }) =>
    request<AdminUser>(`/admin/users/${id}/`, { method: 'PATCH', body }),

  // --- Документы ---
  listDocuments: (params: Record<string, string | number | undefined> = {}) =>
    request<Paginated<DocumentSummary>>('/documents/', { params }),
  getDocument: (id: string, link?: string) =>
    request<Document>(`/documents/${id}/`, { params: { link } }),
  /**
   * Таблица из файла Excel или CSV. Идёт формой, а не JSON: файл в теле
   * запроса, а не в строке — иначе он раздулся бы на треть в base64.
   */
  importDocument: (file: File, folderId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (folderId) form.append('folder_id', folderId)
    return request<Document>('/documents/import/', { method: 'POST', formData: form })
  },
  createDocument: (
    body: { title?: string; folder_id?: string; template_id?: string } = {},
  ) =>
    request<Document>('/documents/', { method: 'POST', body }),
  updateDocument: (id: string, body: DocumentPatch) =>
    request<Document>(`/documents/${id}/`, { method: 'PATCH', body }),
  deleteDocument: (id: string, permanent = false) =>
    request<void>(`/documents/${id}/`, { method: 'DELETE', params: { permanent: permanent ? 'true' : undefined } }),
  restoreDocument: (id: string) => request<Document>(`/documents/${id}/restore/`, { method: 'POST' }),
  copyDocument: (id: string) => request<Document>(`/documents/${id}/copy/`, { method: 'POST' }),
  starDocument: (id: string) => request<{ is_starred: boolean }>(`/documents/${id}/star/`, { method: 'POST' }),
  documentActivity: (id: string) => request<unknown[]>(`/documents/${id}/activity/`),
  searchDocuments: (q: string) => request<DocumentSummary[]>('/documents/search/', { params: { q } }),

  // --- Справочник маршрутов ---
  listPlaces: () => request<Place[]>('/places/'),
  createPlace: (body: { name: string; order?: number }) =>
    request<Place>('/places/', { method: 'POST', body }),
  updatePlace: (id: string, body: Partial<{ name: string; is_active: boolean; order: number }>) =>
    request<Place>(`/places/${id}/`, { method: 'PATCH', body }),
  deletePlace: (id: string) => request<void>(`/places/${id}/`, { method: 'DELETE' }),

  listRouteLegs: () => request<RouteLeg[]>('/route-legs/'),
  createRouteLeg: (body: { origin: string; destination: string; hours: number; note?: string }) =>
    request<RouteLeg>('/route-legs/', { method: 'POST', body }),
  updateRouteLeg: (id: string, body: Partial<{ hours: number; note: string }>) =>
    request<RouteLeg>(`/route-legs/${id}/`, { method: 'PATCH', body }),
  deleteRouteLeg: (id: string) => request<void>(`/route-legs/${id}/`, { method: 'DELETE' }),

  // --- Папки ---
  listFolders: () => request<Folder[]>('/folders/'),
  createFolder: (body: { name: string; parent_id?: string }) =>
    request<Folder>('/folders/', { method: 'POST', body }),
  updateFolder: (id: string, body: { name?: string; parent_id?: string | null }) =>
    request<Folder>(`/folders/${id}/`, { method: 'PATCH', body }),
  deleteFolder: (id: string) => request<void>(`/folders/${id}/`, { method: 'DELETE' }),

  // --- Доступ ---
  listPermissions: (documentId: string) =>
    request<{ owner: Permission; permissions: Permission[]; link: ShareLink | null }>(
      `/documents/${documentId}/permissions/`,
    ),
  grantPermission: (documentId: string, body: { email: string; role: string }) =>
    request<Permission>(`/documents/${documentId}/permissions/`, { method: 'POST', body }),
  updatePermission: (documentId: string, permissionId: number, role: string) =>
    request<Permission>(`/documents/${documentId}/permissions/${permissionId}/`, {
      method: 'PATCH',
      body: { role },
    }),
  revokePermission: (documentId: string, permissionId: number) =>
    request<void>(`/documents/${documentId}/permissions/${permissionId}/`, { method: 'DELETE' }),
  setShareLink: (documentId: string, body: { access: string; role?: string; expires_at?: string | null }) =>
    request<ShareLink>(`/documents/${documentId}/share-link/`, { method: 'PUT', body }),
  resolveShareLink: (token: string) => request<Document>(`/share/${token}/`),

  // --- Версии ---
  listVersions: (documentId: string) => request<Version[]>(`/documents/${documentId}/versions/`),
  saveVersion: (documentId: string, label?: string) =>
    request<Version>(`/documents/${documentId}/versions/`, { method: 'POST', body: { label } }),
  getVersion: (documentId: string, versionId: string) =>
    request<Version & { content: unknown }>(`/documents/${documentId}/versions/${versionId}/`),
  restoreVersion: (documentId: string, versionId: string) =>
    request<Version>(`/documents/${documentId}/versions/${versionId}/restore/`, { method: 'POST' }),

  // --- Шаблоны ---
  listTemplates: (params: Record<string, string> = {}) => request<Template[]>('/templates/', { params }),
  /** Своя заготовка из таблицы: колонки, шапка и формулы — как есть. */
  createTemplateFromDocument: (documentId: string, title?: string) =>
    request<Template>('/templates/from-document/', {
      method: 'POST',
      body: { document_id: documentId, title },
    }),
  deleteTemplate: (id: string) => request<void>(`/templates/${id}/`, { method: 'DELETE' }),
  getTemplate: (id: string) => request<Template & { content: unknown }>(`/templates/${id}/`),

  // --- Уведомления ---
  listNotifications: (unread = false) =>
    request<Paginated<Notification> & { unread_count: number }>('/notifications/', {
      params: { unread: unread ? 'true' : undefined },
    }),
  readNotification: (id: string) => request<Notification>(`/notifications/${id}/read/`, { method: 'POST' }),
  readAllNotifications: () => request<{ updated: number }>('/notifications/read-all/', { method: 'POST' }),

  // --- Файлы ---
  uploadImage: (file: File, documentId?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (documentId) formData.append('document_id', documentId)
    return request<{ id: string; url: string; width: number; height: number }>('/files/images/', {
      method: 'POST',
      formData,
    })
  },
  exportDocument: (documentId: string, format: string) =>
    request<{ task_id: string; format: string }>(`/documents/${documentId}/export/`, {
      params: { format },
    }),
  /** Опрос фоновой задачи выгрузки: файл готовится не мгновенно. */
  taskStatus: (taskId: string) =>
    request<{
      status: 'processing' | 'ready' | 'failed'
      file?: { url: string; original_name: string }
    }>(`/exports/${taskId}/`),

  // --- Публикация ---
  getPublication: (documentId: string) => request<Publication>(`/documents/${documentId}/publish/`),
  publish: (documentId: string, autoUpdate = false) =>
    request<Publication>(`/documents/${documentId}/publish/`, {
      method: 'POST',
      body: { auto_update: autoUpdate },
    }),
  unpublish: (documentId: string) =>
    request<void>(`/documents/${documentId}/publish/`, { method: 'DELETE' }),
  getPublished: (publicId: string) =>
    request<{ title: string; content: unknown; published_at: string }>(`/published/${publicId}/`),
}

export { ApiError, onUnauthorized, refreshTokens, tokens } from './client'
