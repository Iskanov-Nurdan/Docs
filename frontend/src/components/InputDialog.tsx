/** Окно с одним полем: создать папку, переименовать документ. */
import { useState } from 'react'
import { Modal } from './Modal'

type Props = {
  title: string
  label: string
  initialValue?: string
  submitLabel?: string
  placeholder?: string
  onSubmit: (value: string) => void | Promise<void>
  onClose: () => void
}

export function InputDialog({
  title,
  label,
  initialValue = '',
  submitLabel = 'Сохранить',
  placeholder,
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initialValue)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Введите название')
      return
    }

    setBusy(true)
    setError('')
    try {
      await onSubmit(trimmed)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={title} onClose={onClose} width="sm">
      <form onSubmit={submit}>
        <label className="block">
          <span className="mb-1 block text-sm text-ink-muted">{label}</span>
          <input
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
            className="w-full rounded border border-hairline bg-surface px-3 py-2 text-ink outline-none focus:border-accent"
          />
        </label>

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Отмена
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Сохранение…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
