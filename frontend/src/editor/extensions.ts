/**
 * Набор возможностей редактора.
 *
 * История правок (undo/redo) намеренно отключена в StarterKit: при совместном
 * редактировании её ведёт Collaboration, и отмена должна убирать только свои
 * действия. Со стандартной историей Ctrl+Z отменял бы и чужие правки тоже.
 */
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextStyle from '@tiptap/extension-text-style'
import Color from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Table from '@tiptap/extension-table'
import TableRow from '@tiptap/extension-table-row'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import FontFamily from '@tiptap/extension-font-family'
import CharacterCount from '@tiptap/extension-character-count'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCursor from '@tiptap/extension-collaboration-cursor'
import type * as Y from 'yjs'
import type { Awareness } from 'y-protocols/awareness'

type Options = {
  doc: Y.Doc
  awareness: Awareness
  user: { name: string; color: string }
  editable: boolean
}

export function buildExtensions({ doc, awareness, user }: Options) {
  return [
    StarterKit.configure({
      // Историю ведёт Collaboration — см. пояснение в начале файла.
      history: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
    }),
    Underline,
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    FontFamily,
    Subscript,
    Superscript,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Link.configure({
      openOnClick: false,
      autolink: true,
      // Ссылка из документа открывается в новой вкладке и без доступа
      // к странице-источнику: документ может быть чужим.
      HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
    }),
    Image.configure({ inline: false, allowBase64: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder: 'Начните печатать…' }),
    CharacterCount,
    Collaboration.configure({ document: doc }),
    CollaborationCursor.configure({ provider: { awareness } as never, user }),
  ]
}
