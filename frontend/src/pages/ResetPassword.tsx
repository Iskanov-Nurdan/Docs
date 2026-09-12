/** Новый пароль по ссылке из письма: /reset-password?token=… */
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '@/api'

export function ResetPasswordPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password !== repeat) {
      setError('Пароли не совпадают')
      return
    }

    setBusy(true)
    setError('')
    try {
      await api.confirmPasswordReset({ token, new_password: password })
      // Старые сессии сервер отзывает — входить нужно заново.
      navigate('/login', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сменить пароль')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-8 shadow-sm">
        <h1 className="mb-6 text-2xl font-semibold text-ink">Новый пароль</h1>

        {!token ? (
          <>
            <p role="alert" className="mb-4 text-sm text-ink">
              Ссылка неполная: в ней нет кода подтверждения. Запросите письмо ещё раз.
            </p>
            <Link to="/forgot-password" className="text-sm text-accent hover:underline">
              Запросить ссылку
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            {error && (
              <p
                role="alert"
                className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <label className="mb-4 block">
              <span className="mb-1 block text-sm text-ink-muted">Пароль</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>

            <label className="mb-6 block">
              <span className="mb-1 block text-sm text-ink-muted">Повторите пароль</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Сохраняем…' : 'Сохранить пароль'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
