/** Подтверждение необратимого действия. Заменяет window.confirm. */
import { useState } from 'react'
import { Modal } from './Modal'

type Props = {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Подтвердить',
  danger = false,
  onConfirm,
  onClose,
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить действие')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      width="sm"
      footer={
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-hairline px-4 py-2 text-sm hover:bg-surface-muted"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={busy}
            className={[
              'rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50',
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-accent hover:opacity-90',
            ].join(' ')}
          >
            {busy ? 'Выполняется…' : confirmLabel}
          </button>
        </div>
      }
    >
      <p className="text-sm text-ink">{message}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </Modal>
  )
}
