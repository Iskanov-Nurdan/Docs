/** Редактор документа: TipTap поверх Yjs. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import { api } from '@/api'
import { buildExtensions } from './extensions'
import { Toolbar } from './Toolbar'
import { DocumentProvider } from '@/websocket/provider'
import type { Document, EditorMode, Presence, SaveStatus } from '@/types'

type Props = {
  document: Document
  token: string
  linkToken?: string
  user: Presence
  mode: EditorMode
  onStatusChange: (status: SaveStatus) => void
  onPresenceChange: (users: Presence[]) => void
  onEvent?: (event: Record<string, unknown>) => void
}

/** Размеры листа в миллиметрах — для режима «Страницы». */
const PAGE_SIZES = {
  a4: { width: 210, height: 297 },
  letter: { width: 216, height: 279 },
  legal: { width: 216, height: 356 },
}

export function DocumentEditor({
  document: doc,
  token,
  linkToken,
  user,
  mode,
  onStatusChange,
  onPresenceChange,
  onEvent,
}: Props) {
  const [provider, setProvider] = useState<DocumentProvider | null>(null)
  // Редактор нужен провайдеру для снимка, а провайдер редактору — для правок.
  // Ссылка разрывает этот круг: к моменту снимка редактор уже создан.
  const editorRef = useRef<ReturnType<typeof useEditor> | null>(null)

  useEffect(() => {
    const instance = new DocumentProvider({
      documentId: doc.id,
      token,
      linkToken,
      user,
      onStatus: onStatusChange,
      onPresence: onPresenceChange,
      onEvent,
      getContent: () => editorRef.current?.getJSON() ?? null,
    })
    setProvider(instance)

    // Закрытие вкладки не должно стоить пользователю последних правок.
    const flush = () => instance.flush()
    window.addEventListener('beforeunload', flush)

    return () => {
      window.removeEventListener('beforeunload', flush)
      instance.destroy()
      setProvider(null)
    }
    // Пересоздание провайдера — только при смене документа: на каждый ререндер
    // это рвало бы соединение и теряло присутствие.

  }, [doc.id, token, linkToken])

  const extensions = useMemo(() => {
    if (!provider) return []
    return buildExtensions({
      doc: provider.doc,
      awareness: provider.awareness,
      user: { name: user.name, color: user.color },
      editable: mode === 'editing',
    })

  }, [provider])

  const editor = useEditor(
    {
      extensions,
      editable: mode === 'editing',
      editorProps: {
        attributes: {
          class: 'prose-editor outline-none',
          // Проверка орфографии браузера мешает при совместной правке:
          // подчёркивания скачут вслед за чужими курсорами.
          spellcheck: 'false',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': `Документ «${doc.title}»`,
        },
      },
    },
    [extensions],
  )

  editorRef.current = editor

  useEffect(() => {
    editor?.setEditable(mode === 'editing')
  }, [editor, mode])

  // Положение курсора уходит остальным участникам.
  useEffect(() => {
    if (!editor || !provider) return

    const send = () => {
      const { from, to } = editor.state.selection
      provider.sendCursor({ position: from }, from === to ? null : { from, to })
    }
    editor.on('selectionUpdate', send)
    return () => {
      editor.off('selectionUpdate', send)
    }
  }, [editor, provider])

  const insertImage = async () => {
    const input = window.document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file || !editor) return
      try {
        const uploaded = await api.uploadImage(file, doc.id)
        editor.chain().focus().setImage({ src: uploaded.url, alt: file.name }).run()
      } catch (error) {
        window.alert(error instanceof Error ? error.message : 'Не удалось загрузить изображение')
      }
    }
    input.click()
  }

  const insertLink = () => {
    if (!editor) return
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Адрес ссылки', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const insertTable = () => {
    editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }

  const pageStyle = useMemo(() => {
    if (doc.document_mode === 'pageless') {
      // Без разбивки на страницы поля не применяются, а ширина ограничивается
      // читаемой строкой: длинные строки на широком экране читать невозможно.
      return { maxWidth: '900px', padding: '32px 24px', background: doc.page_color }
    }
    const size = PAGE_SIZES[doc.page_size] ?? PAGE_SIZES.a4
    const isLandscape = doc.orientation === 'landscape'
    return {
      width: `${isLandscape ? size.height : size.width}mm`,
      minHeight: `${isLandscape ? size.width : size.height}mm`,
      paddingTop: `${doc.margin_top}mm`,
      paddingBottom: `${doc.margin_bottom}mm`,
      paddingLeft: `${doc.margin_left}mm`,
      paddingRight: `${doc.margin_right}mm`,
      background: doc.page_color,
    }
  }, [doc.document_mode, doc.page_size, doc.orientation, doc.margin_top, doc.margin_bottom,
      doc.margin_left, doc.margin_right, doc.page_color])

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        editor={editor}
        mode={mode}
        onInsertImage={insertImage}
        onInsertLink={insertLink}
        onInsertTable={insertTable}
      />

      <div className="flex-1 overflow-auto bg-surface-muted px-4 py-8">
        <div
          className={[
            'mx-auto shadow-sm ring-1 ring-hairline',
            doc.document_mode === 'pages' ? 'rounded-sm' : 'rounded-lg',
          ].join(' ')}
          style={pageStyle}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  )
}
