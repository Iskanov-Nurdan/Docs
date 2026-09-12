/**
 * Папки пользователя.
 *
 * Дерево нужно сразу в нескольких местах — в боковой панели, в диалоге
 * перемещения и на странице папки, — поэтому список загружается один раз
 * и живёт в общем хранилище, а не в каждом компоненте по отдельности.
 */
import { create } from 'zustand'
import { api } from '@/api'
import type { Folder } from '@/types'

export type FolderNode = Folder & { children: FolderNode[] }

type FoldersState = {
  folders: Folder[]
  loading: boolean
  loaded: boolean
  error: string
  load: (force?: boolean) => Promise<void>
  create: (name: string, parentId?: string) => Promise<Folder>
  rename: (id: string, name: string) => Promise<void>
  move: (id: string, parentId: string | null) => Promise<void>
  remove: (id: string) => Promise<void>
}

export const useFolders = create<FoldersState>((set, get) => ({
  folders: [],
  loading: false,
  loaded: false,
  error: '',

  async load(force = false) {
    if (get().loading || (get().loaded && !force)) return
    set({ loading: true, error: '' })
    try {
      const list = await api.listFolders()
      // Ответ, который не оказался списком, дальше пускать нельзя: дерево
      // строится через forEach, и одна такая выдача роняет всю страницу.
      if (!Array.isArray(list)) {
        set({ error: 'Не удалось загрузить папки' })
        return
      }
      set({ folders: list, loaded: true })
    } catch {
      set({ error: 'Не удалось загрузить папки' })
    } finally {
      set({ loading: false })
    }
  },

  async create(name, parentId) {
    const folder = await api.createFolder({ name, parent_id: parentId })
    // Прошлая неудача больше не актуальна: сервер только что ответил.
    // Иначе рядом с созданной папкой висело бы «Не удалось загрузить папки».
    set({ error: '' })
    set((state) => ({ folders: [...state.folders, folder] }))
    return folder
  },

  async rename(id, name) {
    const folder = await api.updateFolder(id, { name })
    set((state) => ({ folders: state.folders.map((item) => (item.id === id ? folder : item)) }))
  },

  async move(id, parentId) {
    const folder = await api.updateFolder(id, { parent_id: parentId })
    set((state) => ({ folders: state.folders.map((item) => (item.id === id ? folder : item)) }))
  },

  async remove(id) {
    await api.deleteFolder(id)
    // Сервер переносит вложенные папки и документы, поэтому список
    // перечитывается целиком: пересчитывать связи на клиенте незачем.
    await get().load(true)
  },
}))

/** Плоский список — в дерево. Порядок внутри уровня — по названию. */
export function buildFolderTree(folders: Folder[]): FolderNode[] {
  // Боковая панель не стоит падения всего приложения: без папок страница
  // остаётся рабочей, а с исключением здесь не открывается ничего.
  if (!Array.isArray(folders)) return []

  const nodes = new Map<string, FolderNode>()
  folders.forEach((folder) => nodes.set(folder.id, { ...folder, children: [] }))

  const roots: FolderNode[] = []
  nodes.forEach((node) => {
    const parent = node.parent ? nodes.get(node.parent) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  })

  const sort = (list: FolderNode[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    list.forEach((node) => sort(node.children))
  }
  sort(roots)
  return roots
}

/** Путь от корня до папки — для хлебных крошек. */
export function folderPath(folders: Folder[], id: string | null): Folder[] {
  if (!Array.isArray(folders)) return []

  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const path: Folder[] = []
  let current = id ? byId.get(id) : undefined
  while (current) {
    path.unshift(current)
    current = current.parent ? byId.get(current.parent) : undefined
  }
  return path
}
