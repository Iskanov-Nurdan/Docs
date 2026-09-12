/** Запрос письма для восстановления пароля. */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '@/api'

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSending(true)
    setError('')
    try {
      await api.requestPasswordReset(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось отправить письмо')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <div className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-semibold text-ink">Восстановление пароля</h1>

        {sent ? (
          <>
            <p role="status" className="mb-6 mt-4 text-sm text-ink">
              Если такой адрес зарегистрирован, письмо со ссылкой уже отправлено.
              Ссылка действует два часа.
            </p>
            <Link to="/login" className="text-sm text-accent hover:underline">
              Вернуться ко входу
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            <p className="mb-6 text-sm text-ink-muted">
              Укажите почту — пришлём ссылку для смены пароля.
            </p>

            {error && (
              <p
                role="alert"
                className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <label className="mb-6 block">
              <span className="mb-1 block text-sm text-ink-muted">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
              />
            </label>

            <button
              type="submit"
              disabled={sending}
              className="w-full rounded bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {sending ? 'Отправляем…' : 'Отправить ссылку'}
            </button>

            <div className="mt-4 text-center text-sm">
              <Link to="/login" className="text-accent hover:underline">
                Вернуться ко входу
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
