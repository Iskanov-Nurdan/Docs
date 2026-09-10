import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { LoginPage } from '@/pages/Login'
import { RegisterPage } from '@/pages/Register'
import { DocsPage } from '@/pages/Docs'
import { EditorPage } from '@/pages/Editor'

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

  useEffect(() => {
    restore()
  }, [restore])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route
          path="/docs"
          element={
            <Protected>
              <DocsPage />
            </Protected>
          }
        />
        <Route
          path="/docs/:id"
          element={
            <Protected>
              <EditorPage />
            </Protected>
          }
        />
        <Route path="/" element={<Navigate to="/docs" replace />} />
        <Route path="*" element={<Navigate to="/docs" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
