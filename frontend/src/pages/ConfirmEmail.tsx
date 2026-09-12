/** Подтверждение адреса по ссылке из письма: /confirm-email?token=… */
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '@/api'
import { useAuth } from '@/store/auth'

type State = 'checking' | 'done' | 'failed'

export function ConfirmEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const { user, patchUser } = useAuth()
  const [state, setState] = useState<State>(token ? 'checking' : 'failed')
  const [error, setError] = useState(token ? '' : 'Ссылка неполная: в ней нет кода подтверждения.')

  useEffect(() => {
    if (!token) return
    let cancelled = false

    api
      .confirmEmail(token)
      .then(() => {
        if (cancelled) return
        setState('done')
        // Профиль уже загружен — обновляем метку, чтобы не перечитывать его.
        if (user) patchUser({ email_confirmed: true })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState('failed')
        setError(
          err instanceof ApiError ? err.message : 'Ссылка недействительна или срок её истёк.',
        )
      })

    return () => {
      cancelled = true
    }
    // Профиль в зависимостях не нужен: подтверждение выполняется один раз
    // на загрузку страницы, повторный запрос сервер отклонит.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-8 text-center shadow-sm">
        <h1 className="mb-4 text-2xl font-semibold text-ink">Подтверждение адреса</h1>

        {state === 'checking' && (
          <p role="status" className="text-sm text-ink-muted">
            Проверяем ссылку…
          </p>
        )}

        {state === 'done' && (
          <>
            <p className="mb-6 text-sm text-ink">Адрес подтверждён. Спасибо!</p>
            <Link
              to={user ? '/documents' : '/login'}
              className="inline-block rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              {user ? 'К документам' : 'Войти'}
            </Link>
          </>
        )}

        {state === 'failed' && (
          <>
            <p role="alert" className="mb-6 text-sm text-ink">
              {error}
            </p>
            <Link to="/login" className="text-sm text-accent hover:underline">
              Вернуться ко входу
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
