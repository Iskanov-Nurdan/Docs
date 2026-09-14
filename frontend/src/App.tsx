import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { LoginPage } from '@/pages/Login'
import { ForgotPasswordPage } from '@/pages/ForgotPassword'
import { ResetPasswordPage } from '@/pages/ResetPassword'
import { ConfirmEmailPage } from '@/pages/ConfirmEmail'
import { DocumentsPage } from '@/pages/Documents'
import { RoutesPage } from '@/pages/Routes'
import { TemplatesPage } from '@/pages/Templates'
import { SettingsPage } from '@/pages/Settings'
import { AdminPage } from '@/pages/Admin'
import { PublishedPage } from '@/pages/Published'
import { EditorPage } from '@/pages/Editor'
import { applyTheme, readTheme, watchSystemTheme } from '@/utils/theme'
import { ErrorBoundary } from '@/components/ErrorBoundary'

/** Пускает в административную часть только сотрудников. */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth()

  if (!initialized) return <p className="p-12 text-center text-ink-muted">Загрузка…</p>
  // Не «нет доступа», а возврат к документам: страницы, которой человеку
  // не видно, для него и не существует.
  if (!user?.is_staff) return <Navigate to="/documents" replace />
  return <>{children}</>
}

/** Пускает дальше только вошедших. */
function Protected({ children }: { children: React.ReactNode }) {
  const { user, initialized } = useAuth()

  // Пока сессия восстанавливается, нельзя ни пускать, ни выбрасывать:
  // иначе обновление страницы выкидывало бы на форму входа.
  if (!initialized) return <p className="p-12 text-center text-ink-muted">Загрузка…</p>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

export function App() {
  const restore = useAuth((state) => state.restore)
  const theme = useAuth((state) => state.user?.theme)

  useEffect(() => {
    applyTheme(readTheme())
    return watchSystemTheme()
  }, [])

  // Выбор из профиля перекрывает локальный: человек мог войти на чужом
  // устройстве, и его настройка должна приехать вместе с ним.
  useEffect(() => {
    if (theme) applyTheme(theme)
  }, [theme])

  useEffect(() => {
    restore()
  }, [restore])

  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/confirm-email" element={<ConfirmEmailPage />} />
          <Route path="/public/document/:publicId" element={<PublishedPage />} />

          <Route
            path="/documents"
            element={
              <Protected>
                <DocumentsPage scope="active" />
              </Protected>
            }
          />
          <Route
            path="/documents/:id"
            element={
              <Protected>
                <EditorPage />
              </Protected>
            }
          />
          <Route
            path="/folders/:id"
            element={
              <Protected>
                <DocumentsPage scope="folder" />
              </Protected>
            }
          />
          <Route
            path="/starred"
            element={
              <Protected>
                <DocumentsPage scope="starred" />
              </Protected>
            }
          />
          <Route
            path="/shared"
            element={
              <Protected>
                <DocumentsPage scope="shared" />
              </Protected>
            }
          />
          <Route
            path="/trash"
            element={
              <Protected>
                <DocumentsPage scope="trash" />
              </Protected>
            }
          />
          <Route
            path="/templates"
            element={
              <Protected>
                <TemplatesPage />
              </Protected>
            }
          />
          <Route
            path="/routes"
            element={
              <Protected>
                <RoutesPage />
              </Protected>
            }
          />
          <Route
            path="/settings"
            element={
              <Protected>
                <SettingsPage />
              </Protected>
            }
          />

          <Route
            path="/admin"
            element={
              <Protected>
                <AdminOnly>
                  <AdminPage />
                </AdminOnly>
              </Protected>
            }
          />

          {/* Прежние адреса: ссылки на документы уже разошлись по почте. */}
          <Route path="/docs" element={<Navigate to="/documents" replace />} />
          <Route path="/docs/:id" element={<RedirectToDocument />} />

          <Route path="/" element={<Navigate to="/documents" replace />} />
          <Route path="*" element={<Navigate to="/documents" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

/** Старый адрес документа вместе с параметрами ссылки доступа. */
function RedirectToDocument() {
  const path = window.location.pathname.replace(/^\/docs\//, '/documents/')
  return <Navigate to={`${path}${window.location.search}`} replace />
}
