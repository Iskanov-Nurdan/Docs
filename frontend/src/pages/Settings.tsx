/** Настройки: профиль, оформление, пароль. */
import { useEffect, useRef, useState } from 'react'
import { AppLayout } from '@/components/AppLayout'
import { ApiError, api } from '@/api'
import { Select } from '@/components/Select'
import { useAuth } from '@/store/auth'
import { formatDateTime } from '@/utils/date'
import { applyTheme, type Theme } from '@/utils/theme'

const THEMES: { value: Theme; label: string }[] = [
  { value: 'system', label: 'Как в системе' },
  { value: 'light', label: 'Светлая' },
  { value: 'dark', label: 'Тёмная' },
]

const LANGUAGES = [
  { value: 'ru', label: 'Русский' },
  { value: 'ky', label: 'Кыргызча' },
  { value: 'en', label: 'English' },
]

export function SettingsPage() {
  const { user, patchUser } = useAuth()
  const [firstName, setFirstName] = useState(user?.first_name ?? '')
  const [lastName, setLastName] = useState(user?.last_name ?? '')
  const [saving, setSaving] = useState(false)
  const [profileMessage, setProfileMessage] = useState('')
  const [profileError, setProfileError] = useState('')
  const avatarInput = useRef<HTMLInputElement>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [passwordMessage, setPasswordMessage] = useState('')
  const [passwordError, setPasswordError] = useState('')

  useEffect(() => {
    setFirstName(user?.first_name ?? '')
    setLastName(user?.last_name ?? '')
  }, [user])

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setProfileMessage('')
    setProfileError('')
    try {
      const updated = await api.updateProfile({ first_name: firstName, last_name: lastName })
      patchUser(updated)
      setProfileMessage('Профиль сохранён')
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Не удалось сохранить профиль')
    } finally {
      setSaving(false)
    }
  }

  const uploadAvatar = async (file: File) => {
    setProfileError('')
    try {
      patchUser(await api.uploadAvatar(file))
      setProfileMessage('Аватар обновлён')
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Не удалось загрузить изображение')
    }
  }

  /** Оформление применяется сразу, а на сервер уходит фоном: ждать ответа,
   *  чтобы увидеть выбранную тему, человеку незачем.
   *
   *  Но молчать о неудаче нельзя. Выбор из профиля перекрывает местный при
   *  следующей загрузке, поэтому несохранённая тема возвращается к прежней
   *  после обновления страницы — и выглядит это как «переключатель не работает». */
  const changeTheme = (theme: Theme) => {
    applyTheme(theme)
    patchUser({ theme })
    api.updateProfile({ theme }).catch(() => {
      setProfileError('Тема применена, но не сохранена на сервере — после обновления страницы вернётся прежняя.')
    })
  }

  const changeLanguage = (language: string) => {
    patchUser({ language })
    api.updateProfile({ language }).catch(() => {
      setProfileError('Не удалось сохранить язык интерфейса.')
    })
  }

  const changeNotifications = (enabled: boolean) => {
    patchUser({ email_notifications: enabled })
    api.updateProfile({ email_notifications: enabled }).catch(() => {
      setProfileError('Не удалось сохранить настройку уведомлений.')
    })
  }

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setPasswordBusy(true)
    setPasswordMessage('')
    setPasswordError('')
    try {
      await api.changePassword({ current_password: currentPassword, new_password: newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setPasswordMessage('Пароль изменён')
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Не удалось изменить пароль')
    } finally {
      setPasswordBusy(false)
    }
  }

  if (!user) {
    return (
      <AppLayout title="Настройки">
        <p className="py-12 text-center text-ink-muted">Загрузка…</p>
      </AppLayout>
    )
  }

  const field = 'w-full rounded-full border border-hairline bg-surface px-4 py-2 text-ink outline-none focus:border-accent'
  const card = 'mb-6 rounded-lg border border-hairline bg-surface p-5'

  return (
    <AppLayout title="Настройки">
      <div className="max-w-2xl">
        <section className={card} aria-labelledby="profile-heading">
          <h2 id="profile-heading" className="mb-4 text-base font-semibold text-ink">
            Профиль
          </h2>

          <div className="mb-5 flex items-center gap-4">
            {user.avatar ? (
              <img src={user.avatar} alt="" className="h-16 w-16 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-lg font-semibold text-white">
                {user.initials ?? user.display_name.slice(0, 2).toUpperCase()}
              </span>
            )}

            <div>
              <input
                ref={avatarInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) uploadAvatar(file)
                }}
              />
              <button
                type="button"
                onClick={() => avatarInput.current?.click()}
                className="rounded border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
              >
                Загрузить аватар
              </button>
              <p className="mt-1 text-xs text-ink-muted">JPG или PNG, до 5 МБ</p>
            </div>
          </div>

          <form onSubmit={saveProfile}>
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-sm text-ink-muted">Имя</span>
                <input
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  className={field}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-sm text-ink-muted">Фамилия</span>
                <input
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  className={field}
                />
              </label>
            </div>

            <dl className="mb-4 text-sm">
              <div className="flex gap-2">
                <dt className="text-ink-muted">Почта:</dt>
                <dd className="text-ink">
                  {user.email}
                  {user.email_confirmed === false && (
                    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                      не подтверждена
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="text-ink-muted">Регистрация:</dt>
                <dd className="text-ink">{formatDateTime(user.created_at)}</dd>
              </div>
            </dl>

            {profileError && (
              <p role="alert" className="mb-3 text-sm text-red-600">
                {profileError}
              </p>
            )}
            {profileMessage && (
              <p role="status" className="mb-3 text-sm text-emerald-700">
                {profileMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={saving}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </form>
        </section>

        <section className={card} aria-labelledby="appearance-heading">
          <h2 id="appearance-heading" className="mb-4 text-base font-semibold text-ink">
            Оформление
          </h2>

          <div className="mb-4">
            <span className="mb-1 block text-sm text-ink-muted">Тема</span>
            <Select label="Тема" value={user.theme ?? 'system'} options={THEMES} onChange={changeTheme} block />
          </div>

          <div className="mb-4">
            <span className="mb-1 block text-sm text-ink-muted">Язык интерфейса</span>
            <Select
              label="Язык интерфейса"
              value={user.language ?? 'ru'}
              options={LANGUAGES}
              onChange={changeLanguage}
              block
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={user.email_notifications ?? true}
              onChange={(event) => changeNotifications(event.target.checked)}
            />
            Присылать уведомления на почту
          </label>
        </section>

        <section className={card} aria-labelledby="password-heading">
          <h2 id="password-heading" className="mb-4 text-base font-semibold text-ink">
            Смена пароля
          </h2>

          <form onSubmit={changePassword}>
            <label className="mb-4 block">
              <span className="mb-1 block text-sm text-ink-muted">Текущий пароль</span>
              <input
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className={field}
              />
            </label>

            <label className="mb-4 block">
              <span className="mb-1 block text-sm text-ink-muted">Новый пароль</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className={field}
              />
            </label>

            {passwordError && (
              <p role="alert" className="mb-3 text-sm text-red-600">
                {passwordError}
              </p>
            )}
            {passwordMessage && (
              <p role="status" className="mb-3 text-sm text-emerald-700">
                {passwordMessage}
              </p>
            )}

            <button
              type="submit"
              disabled={passwordBusy}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {passwordBusy ? 'Сохранение…' : 'Изменить пароль'}
            </button>
          </form>
        </section>
      </div>
    </AppLayout>
  )
}
