import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { ApiError } from '@/api'

export function LoginPage() {
  const navigate = useNavigate()
  const { login, loading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      await login(email, password)
      navigate('/documents')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти')
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-8 shadow-sm"
      >
        <h1 className="mb-1 text-2xl font-semibold text-ink">
          ALI<span className="text-accent"> trade</span>
        </h1>
        <p className="mb-6 text-sm text-ink-muted">Документы и совместная работа</p>

        {error && (
          <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <label className="mb-4 block">
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

        <label className="mb-6 block">
          <span className="mb-1 block text-sm text-ink-muted">Пароль</span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Входим…' : 'Войти'}
        </button>

        <div className="mt-4 text-center text-sm">
          <Link to="/forgot-password" className="text-ink-muted hover:underline">
            Забыли пароль?
          </Link>
        </div>

        {/* Регистрации нет: учётные записи заводит администратор. Без этой
            подписи человек искал бы кнопку «зарегистрироваться». */}
        <p className="mt-6 border-t border-hairline pt-4 text-center text-xs text-ink-muted">
          Нет учётной записи? Её заводит администратор — обратитесь к нему.
        </p>
      </form>
    </div>
  )
}
