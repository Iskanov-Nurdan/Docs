/** Методы API — по одному на конечную точку бэкенда. */
import { request, tokens } from './client'
import type {
  Comment,
  Document,
  DocumentSummary,
  Folder,
  Notification,
  Paginated,
  Permission,
  ShareLink,
  Suggestion,
  Template,
  User,
  Version,
} from '@/types'

type AuthResponse = { user: User; access: string; refresh: string }

export const api = {
  // --- Вход и учётная запись ---
  register: (body: { email: string; password: string; first_name?: string; last_name?: string }) =>
    request<AuthResponse>('/auth/register/', { method: 'POST', body }),
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
  searchUsers: (q: string) => request<User[]>('/users/search/', { params: { q } }),

  // --- Документы ---
  listDocuments: (params: Record<string, string | number | undefined> = {}) =>
    request<Paginated<DocumentSummary>>('/documents/', { params }),
  getDocument: (id: string, link?: string) =>
    request<Document>(`/documents/${id}/`, { params: { link } }),
  createDocument: (body: { title?: string; folder_id?: string; template_id?: string } = {}) =>
    request<Document>('/documents/', { method: 'POST', body }),
  updateDocument: (id: string, body: Partial<Document>) =>
    request<Document>(`/documents/${id}/`, { method: 'PATCH', body }),
  deleteDocument: (id: string, permanent = false) =>
    request<void>(`/documents/${id}/`, { method: 'DELETE', params: { permanent: permanent ? 'true' : undefined } }),
  restoreDocument: (id: string) => request<Document>(`/documents/${id}/restore/`, { method: 'POST' }),
  copyDocument: (id: string) => request<Document>(`/documents/${id}/copy/`, { method: 'POST' }),
  starDocument: (id: string) => request<{ is_starred: boolean }>(`/documents/${id}/star/`, { method: 'POST' }),
  documentActivity: (id: string) => request<unknown[]>(`/documents/${id}/activity/`),
  searchDocuments: (q: string) => request<DocumentSummary[]>('/documents/search/', { params: { q } }),

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

  // --- Комментарии и правки ---
  listComments: (documentId: string, params: Record<string, string> = {}) =>
    request<Comment[]>(`/documents/${documentId}/comments/`, { params }),
  addComment: (
    documentId: string,
    body: {
      content: string
      selection_data?: unknown
      quoted_text?: string
      parent_id?: string
      assignee_email?: string
    },
  ) => request<Comment>(`/documents/${documentId}/comments/`, { method: 'POST', body }),
  updateComment: (id: string, content: string) =>
    request<Comment>(`/comments/${id}/`, { method: 'PATCH', body: { content } }),
  deleteComment: (id: string) => request<void>(`/comments/${id}/`, { method: 'DELETE' }),
  resolveComment: (id: string) => request<Comment>(`/comments/${id}/resolve/`, { method: 'POST' }),
  reopenComment: (id: string) => request<Comment>(`/comments/${id}/reopen/`, { method: 'POST' }),
  completeTask: (id: string, completed: boolean) =>
    request<Comment>(`/comments/${id}/task/`, { method: 'POST', body: { completed } }),
  toggleReaction: (id: string, emoji: string) =>
    request<{ added: boolean }>(`/comments/${id}/reactions/`, { method: 'POST', body: { emoji } }),

  listSuggestions: (documentId: string, status?: string) =>
    request<Suggestion[]>(`/documents/${documentId}/suggestions/`, { params: { status } }),
  addSuggestion: (documentId: string, body: Record<string, unknown>) =>
    request<Suggestion>(`/documents/${documentId}/suggestions/`, { method: 'POST', body }),
  resolveSuggestion: (id: string, action: 'accept' | 'reject') =>
    request<Suggestion>(`/suggestions/${id}/resolve/`, { method: 'POST', body: { action } }),

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
  importDocument: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return request<{ task_id: string }>('/documents/import/', { method: 'POST', formData })
  },
  exportDocument: (documentId: string, format: string) =>
    request<{ task_id: string; format: string }>(`/documents/${documentId}/export/`, {
      params: { format },
    }),
  exportStatus: (taskId: string) =>
    request<{ status: string; file?: { url: string; original_name: string } }>(`/exports/${taskId}/`),

  // --- Публикация ---
  getPublication: (documentId: string) => request<Record<string, unknown>>(`/documents/${documentId}/publish/`),
  publish: (documentId: string, autoUpdate = false) =>
    request<Record<string, unknown>>(`/documents/${documentId}/publish/`, {
      method: 'POST',
      body: { auto_update: autoUpdate },
    }),
  unpublish: (documentId: string) =>
    request<void>(`/documents/${documentId}/publish/`, { method: 'DELETE' }),
  getPublished: (publicId: string) =>
    request<{ title: string; content: unknown; published_at: string }>(`/published/${publicId}/`),
}

export { ApiError, tokens } from './client'
