/**
 * Настройка доступа к документу.
 *
 * Права проверяет сервер — здесь только их отображение. Скрытая кнопка ничего
 * не защищает, поэтому недоступные действия именно отключены и подписаны.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from '@/api'
import { Modal } from '@/components/Modal'
import { Select } from '@/components/Select'
import type { Document, Permission, Publication, Role, ShareLink } from '@/types'

type Props = {
  document: Document
  onClose: () => void
  onDocumentChange: (document: Document) => void
}

const ROLES: { value: Exclude<Role, 'owner'>; label: string; hint: string }[] = [
  { value: 'viewer', label: 'Читатель', hint: 'Только просмотр' },
  { value: 'commenter', label: 'Комментатор', hint: 'Просмотр, комментарии и предложения правок' },
  { value: 'editor', label: 'Редактор', hint: 'Правка документа' },
]

const RESTRICTIONS: { key: 'allow_download' | 'allow_copy' | 'allow_print'; label: string }[] = [
  { key: 'allow_download', label: 'Разрешить скачивание' },
  { key: 'allow_copy', label: 'Разрешить создание копий' },
  { key: 'allow_print', label: 'Разрешить печать' },
]

export function ShareDialog({ document: doc, onClose, onDocumentChange }: Props) {
  const [owner, setOwner] = useState<Permission | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [link, setLink] = useState<ShareLink | null>(null)
  const [publication, setPublication] = useState<Publication | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<Role, 'owner'>>('viewer')
  const [busy, setBusy] = useState(false)

  const isOwner = doc.my_role === 'owner'

  const load = useCallback(async () => {
    try {
      setError('')
      const [data, published] = await Promise.all([
        api.listPermissions(doc.id),
        api.getPublication(doc.id),
      ])
      setOwner(data.owner)
      setPermissions(data.permissions)
      setLink(data.link)
      setPublication(published)
    } catch {
      setError('Не удалось загрузить список доступа')
    } finally {
      setLoading(false)
    }
  }, [doc.id])

  useEffect(() => {
    load()
  }, [load])

  const guard = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'Действие не удалось')
    } finally {
      setBusy(false)
    }
  }

  const invite = () =>
    guard(async () => {
      if (!email.trim()) return
      const granted = await api.grantPermission(doc.id, { email: email.trim(), role })
      setPermissions((prev) => [
        granted,
        ...prev.filter((item) => item.user.id !== granted.user.id),
      ])
      setEmail('')
      setNotice(`Доступ открыт: ${granted.user.display_name}`)
    })

  const changeRole = (permission: Permission, next: string) =>
    guard(async () => {
      const updated = await api.updatePermission(doc.id, permission.id, next)
      setPermissions((prev) => prev.map((item) => (item.id === permission.id ? updated : item)))
    })

  const revoke = (permission: Permission) =>
    guard(async () => {
      await api.revokePermission(doc.id, permission.id)
      setPermissions((prev) => prev.filter((item) => item.id !== permission.id))
    })

  const changeLink = (access: 'restricted' | 'anyone', linkRole?: string) =>
    guard(async () => {
      setLink(
        await api.setShareLink(doc.id, {
          access,
          role: linkRole ?? link?.role ?? 'viewer',
        }),
      )
    })

  const copyLink = async () => {
    const url = `${window.location.origin}/documents/${doc.id}${
      link?.access === 'anyone' ? `?link=${link.token}` : ''
    }`
    try {
      await navigator.clipboard.writeText(url)
      setNotice('Ссылка скопирована')
    } catch {
      // Буфер обмена закрыт (нет https или отказано в доступе) — показываем
      // ссылку, чтобы её можно было скопировать вручную.
      setNotice(url)
    }
  }

  const publish = (autoUpdate: boolean) =>
    guard(async () => {
      setPublication({ ...(await api.publish(doc.id, autoUpdate)), published: true })
      onDocumentChange({ ...doc, is_published: true })
    })

  const unpublish = () =>
    guard(async () => {
      await api.unpublish(doc.id)
      setPublication({ published: false })
      onDocumentChange({ ...doc, is_published: false })
    })

  const copyPublicLink = async () => {
    if (!publication?.public_id) return
    const url = `${window.location.origin}/public/document/${publication.public_id}`
    try {
      await navigator.clipboard.writeText(url)
      setNotice('Ссылка на публикацию скопирована')
    } catch {
      setNotice(url)
    }
  }

  const toggleRestriction = (key: 'allow_download' | 'allow_copy' | 'allow_print', value: boolean) =>
    guard(async () => {
      onDocumentChange(await api.updateDocument(doc.id, { [key]: value }))
    })

  return (
    <Modal title="Настройки доступа" onClose={onClose} width="md">
      {loading ? (
        <p className="py-6 text-center text-sm text-ink-muted">Загрузка…</p>
      ) : (
        <div className="space-y-5">
          {error && <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          {notice && (
            <p className="break-all rounded bg-surface-muted px-3 py-2 text-sm text-ink-muted">
              {notice}
            </p>
          )}

          {isOwner && (
            <div>
              <label htmlFor="share-email" className="mb-1 block text-sm font-medium text-ink">
                Пригласить по почте
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="share-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') invite()
                  }}
                  placeholder="name@example.com"
                  className="min-w-0 flex-1 rounded border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <Select
                  label="Роль приглашаемого"
                  value={role}
                  options={ROLES.map((item) => ({ value: item.value, label: item.label, hint: item.hint }))}
                  onChange={setRole}
                />
                <button
                  type="button"
                  onClick={invite}
                  disabled={busy || !email.trim()}
                  className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  Пригласить
                </button>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {ROLES.find((item) => item.value === role)?.hint}
              </p>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-medium text-ink">Есть доступ</h3>
            <ul className="divide-y divide-hairline rounded border border-hairline">
              {owner && (
                <li className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {owner.user.display_name}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {owner.user.email}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">Владелец</span>
                </li>
              )}

              {permissions.map((permission) => (
                <li key={permission.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {permission.user.display_name}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {permission.user.email}
                    </span>
                  </span>

                  {isOwner ? (
                    <>
                      <Select
                        label={`Роль: ${permission.user.display_name}`}
                        value={permission.role as Exclude<Role, 'owner'>}
                        options={ROLES.map((item) => ({ value: item.value, label: item.label }))}
                        disabled={busy}
                        onChange={(next) => changeRole(permission, next)}
                      />
                      <button
                        type="button"
                        onClick={() => revoke(permission)}
                        disabled={busy}
                        aria-label={`Убрать доступ: ${permission.user.display_name}`}
                        className="shrink-0 rounded px-2 py-1 text-xs text-ink-muted hover:text-red-600"
                      >
                        ×
                      </button>
                    </>
                  ) : (
                    <span className="shrink-0 text-xs text-ink-muted">
                      {permission.role_display}
                    </span>
                  )}
                </li>
              ))}

              {permissions.length === 0 && (
                <li className="px-3 py-2 text-xs text-ink-muted">
                  Кроме владельца доступ никому не открыт
                </li>
              )}
            </ul>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-medium text-ink">Доступ по ссылке</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                label="Кому доступна ссылка"
                value={link?.access ?? 'restricted'}
                options={[
                  { value: 'restricted', label: 'Только приглашённые' },
                  { value: 'anyone', label: 'Все, у кого есть ссылка' },
                ]}
                disabled={!isOwner || busy}
                onChange={(access) => changeLink(access as 'restricted' | 'anyone')}
              />

              {link?.access === 'anyone' && (
                <Select
                  label="Права по ссылке"
                  value={link.role as Exclude<Role, 'owner'>}
                  options={ROLES.map((item) => ({ value: item.value, label: item.label }))}
                  disabled={!isOwner || busy}
                  onChange={(next) => changeLink('anyone', next)}
                />
              )}

              <button
                type="button"
                onClick={copyLink}
                className="rounded border border-hairline px-3 py-2 text-sm hover:bg-surface-muted"
              >
                Скопировать ссылку
              </button>
            </div>
            {!isOwner && (
              <p className="mt-1 text-xs text-ink-muted">Менять доступ может только владелец.</p>
            )}
          </div>

          {isOwner && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-ink">Публикация в вебе</h3>

              {publication?.published ? (
                <>
                  <p className="mb-2 text-xs text-ink-muted">
                    Страница открыта всем без входа в систему
                    {typeof publication.views_count === 'number' &&
                      `, просмотров: ${publication.views_count}`}
                    .
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={copyPublicLink}
                      className="rounded border border-hairline px-3 py-2 text-sm hover:bg-surface-muted"
                    >
                      Скопировать ссылку
                    </button>
                    <button
                      type="button"
                      onClick={() => publish(publication.auto_update ?? false)}
                      disabled={busy}
                      className="rounded border border-hairline px-3 py-2 text-sm hover:bg-surface-muted disabled:opacity-40"
                    >
                      Обновить страницу
                    </button>
                    <button
                      type="button"
                      onClick={unpublish}
                      disabled={busy}
                      className="rounded px-3 py-2 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
                    >
                      Снять с публикации
                    </button>
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={publication.auto_update ?? false}
                      disabled={busy}
                      onChange={(event) => publish(event.target.checked)}
                    />
                    Обновлять страницу вместе с документом
                  </label>
                </>
              ) : (
                <>
                  <p className="mb-2 text-xs text-ink-muted">
                    Опубликованный документ виден всем, у кого есть ссылка, — даже без учётной
                    записи. Правки черновика на страницу не попадают, пока вы её не обновите.
                  </p>
                  <button
                    type="button"
                    onClick={() => publish(false)}
                    disabled={busy}
                    className="rounded border border-hairline px-3 py-2 text-sm hover:bg-surface-muted disabled:opacity-40"
                  >
                    Опубликовать
                  </button>
                </>
              )}
            </div>
          )}

          {isOwner && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-ink">Что разрешено остальным</h3>
              <ul className="space-y-1">
                {RESTRICTIONS.map((item) => (
                  <li key={item.key}>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={doc[item.key]}
                        disabled={busy}
                        onChange={(event) => toggleRestriction(item.key, event.target.checked)}
                      />
                      {item.label}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
