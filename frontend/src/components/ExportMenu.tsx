/**
 * Выгрузка документа и печать.
 *
 * Файл готовит Celery, поэтому кнопка не скачивает сразу, а ждёт готовности:
 * PDF большого документа собирается несколько секунд. Ссылку открываем в новой
 * вкладке — переход на файл в текущей выбросил бы человека из редактора.
 */
import { useState } from 'react'
import { InputDialog } from '@/components/InputDialog'
import { Menu } from '@/components/Menu'
import { DownloadIcon, TemplateIcon } from '@/components/icons'
import { ApiError, api } from '@/api'
import type { Document } from '@/types'

// Excel и CSV идут первыми — именно их ждут, когда данные переносят
// в другую программу.
const FORMATS = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'Таблица (.csv)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
  { value: 'docx', label: 'Word (.docx)' },
  { value: 'txt', label: 'Текст с табуляцией (.txt)' },
]

const POLL_MS = 1500
const MAX_ATTEMPTS = 40

export function ExportMenu({ document: doc }: { document: Document }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const download = async (format: string) => {
    setBusy(true)
    setError('')
    try {
      const { task_id } = await api.exportDocument(doc.id, format)

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const status = await api.taskStatus(task_id)
        if (status.status === 'ready' && status.file) {
          window.open(status.file.url, '_blank', 'noopener')
          return
        }
        if (status.status === 'failed') break
        await new Promise((resolve) => window.setTimeout(resolve, POLL_MS))
      }
      setError('Не удалось подготовить файл')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось подготовить файл')
    } finally {
      setBusy(false)
    }
  }

  const items = [
    ...FORMATS.map((format) => ({
      label: `Скачать ${format.label}`,
      icon: <DownloadIcon size={16} />,
      disabled: busy || !doc.allow_download,
      onSelect: () => download(format.value),
    })),
    {
      label: 'Печать',
      disabled: !doc.allow_print,
      onSelect: () => window.print(),
    },
    {
      // Своя заготовка: та же таблица без данных приходится нужна каждый
      // раз, когда заводят новый журнал или новый месяц.
      label: 'Сохранить как шаблон',
      icon: <TemplateIcon size={16} />,
      disabled: !doc.allow_copy && doc.my_role !== 'owner',
      onSelect: () => setSaving(true),
    },
  ]

  const saveTemplate = async (title: string) => {
    try {
      await api.createTemplateFromDocument(doc.id, title)
      setSaving(false)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 4000)
    } catch (err) {
      // Ошибку показывает само окно: оно остаётся открытым, и введённое
      // название не теряется.
      throw new Error(err instanceof ApiError ? err.message : 'Не удалось сохранить шаблон')
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Menu
        label="Файл"
        trigger={
          <span className="flex items-center gap-1.5">
            <DownloadIcon size={16} />
            {busy ? 'Готовим…' : 'Файл'}
          </span>
        }
        items={items}
        className="rounded-full border border-hairline px-3 py-1.5 text-sm text-ink hover:bg-surface-muted"
      />
      {error && (
        <span role="alert" className="text-xs text-red-600">
          {error}
        </span>
      )}
      {saved && (
        <span role="status" className="text-xs text-ink-muted">
          Шаблон сохранён — он в разделе «Шаблоны»
        </span>
      )}

      {saving && (
        <InputDialog
          title="Сохранить как шаблон"
          label="Название шаблона"
          initialValue={doc.title}
          submitLabel="Сохранить"
          onSubmit={saveTemplate}
          onClose={() => setSaving(false)}
        />
      )}
    </div>
  )
}
