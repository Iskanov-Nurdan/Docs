/**
 * Заведение учётной записи.
 *
 * Регистрации в системе нет, поэтому пароль придумывает администратор и
 * передаёт человеку лично. Кнопка «придумать» ставит случайный — так пароли
 * не превращаются в «12345678» на всю контору.
 *
 * После создания пароль показывается ещё раз: восстановить его будет уже
 * нельзя, в базе лежит только хеш.
 */
import { useState } from 'react'
import { Modal } from './Modal'
import { Select } from './Select'
import { CheckIcon, CopyIcon } from './icons'
import { ApiError, api } from '@/api'
import type { AdminUser } from '@/types'

const ROLES = [
  { value: 'member', label: 'Пользователь', hint: 'Работает со своими таблицами' },
  { value: 'admin', label: 'Администратор', hint: 'Видит людей и закрывает доступ' },
]

/** Пароль из букв и цифр без похожих знаков: 0 и O, 1 и l путают при диктовке. */
function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const values = crypto.getRandomValues(new Uint32Array(12))
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join('')
}

type Props = {
  /** Уровень «администратор» доступен только главному админу. */
  canCreateAdmins: boolean
  onCreated: (user: AdminUser) => void
  onClose: () => void
}

export function NewUserDialog({ canCreateAdmins, onCreated, onClose }: Props) {
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState(generatePassword)
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<AdminUser | null>(null)
  const [copied, setCopied] = useState(false)

  const field =
    'w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = await api.createUser({
        email: email.trim(),
        password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        role,
      })
      onCreated(user)
      setCreated(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось завести учётную запись')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${email.trim()} / ${password}`)
      setCopied(true)
    } catch {
      // Буфер закрыт — пароль и так на экране, скопируют вручную.
      setCopied(false)
    }
  }

  if (created) {
    return (
      <Modal
        title="Учётная запись готова"
        onClose={onClose}
        width="sm"
        footer={
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Готово
            </button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-ink">
          Передайте эти данные человеку. Пароль больше нигде не показывается —
          в базе хранится только его отпечаток.
        </p>

        <dl className="rounded-xl bg-surface-muted px-3 py-2 text-sm">
          <div className="flex gap-2 py-1">
            <dt className="w-20 shrink-0 text-ink-muted">Почта</dt>
            <dd className="break-all text-ink">{created.email}</dd>
          </div>
          <div className="flex gap-2 py-1">
            <dt className="w-20 shrink-0 text-ink-muted">Пароль</dt>
            <dd className="break-all font-mono text-ink">{password}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={copy}
          className="mt-3 flex items-center gap-1.5 rounded-full border border-hairline px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? 'Скопировано' : 'Скопировать'}
        </button>
      </Modal>
    )
  }

  return (
    <Modal title="Новый пользователь" onClose={onClose} width="sm">
      <form onSubmit={submit}>
        <label className="mb-4 block">
          <span className="mb-1 block text-sm text-ink-muted">Почта</span>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            className={field}
          />
        </label>

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-sm text-ink-muted">Имя</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-ink-muted">Фамилия</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={field} />
          </label>
        </div>

        <label className="mb-1 block">
          <span className="mb-1 block text-sm text-ink-muted">Пароль</span>
          <input
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={`${field} font-mono`}
          />
        </label>
        <button
          type="button"
          onClick={() => setPassword(generatePassword())}
          className="mb-4 text-xs text-accent hover:underline"
        >
          Придумать другой
        </button>

        <div className="mb-4">
          <span className="mb-1 block text-sm text-ink-muted">Уровень прав</span>
          <Select
            label="Уровень прав"
            value={role}
            options={canCreateAdmins ? ROLES : ROLES.slice(0, 1)}
            onChange={(next) => setRole(next as 'member' | 'admin')}
            block
          />
          {!canCreateAdmins && (
            <p className="mt-1 text-xs text-ink-muted">
              Заводить администраторов может только главный админ
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="mb-3 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Заводим…' : 'Завести'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
