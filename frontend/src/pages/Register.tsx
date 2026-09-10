import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '@/store/auth'
import { ApiError } from '@/api'

export function RegisterPage() {
  const navigate = useNavigate()
  const { register, loading } = useAuth()
  const [form, setForm] = useState({ email: '', password: '', first_name: '', last_name: '' })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})

  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: event.target.value }))

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    setFieldErrors({})
    try {
      await register(form)
      navigate('/docs')
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message)
        // Требования к паролю приходят по полям: показываем их у поля,
        // а не одной строкой поверх формы.
        setFieldErrors(err.fields ?? {})
      } else {
        setError('Не удалось зарегистрироваться')
      }
    }
  }

  const fieldError = (name: string) => fieldErrors[name]?.[0]

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4 py-8">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-8 shadow-sm"
      >
        <h1 className="mb-6 text-2xl font-semibold text-ink">Регистрация</h1>

        {error && (
          <p role="alert" className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mb-4 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-sm text-ink-muted">Имя</span>
            <input
              value={form.first_name}
              onChange={update('first_name')}
              autoComplete="given-name"
              className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-muted">Фамилия</span>
            <input
              value={form.last_name}
              onChange={update('last_name')}
              autoComplete="family-name"
              className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
            />
          </label>
        </div>

        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Email</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={form.email}
            onChange={update('email')}
            aria-invalid={Boolean(fieldError('email'))}
            className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
          {fieldError('email') && (
            <span className="mt-1 block text-xs text-red-600">{fieldError('email')}</span>
          )}
        </label>

        <label className="mb-6 block">
          <span className="mb-1 block text-sm text-ink-muted">Пароль</span>
          <input
            type="password"
            required
            autoComplete="new-password"
            value={form.password}
            onChange={update('password')}
            aria-invalid={Boolean(fieldError('password'))}
            className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
          {fieldError('password') && (
            <span className="mt-1 block text-xs text-red-600">{fieldError('password')}</span>
          )}
        </label>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-accent px-4 py-2 font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {loading ? 'Создаём…' : 'Создать аккаунт'}
        </button>

        <p className="mt-4 text-center text-sm text-ink-muted">
          Уже есть аккаунт?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Войти
          </Link>
        </p>
      </form>
    </div>
  )
}
