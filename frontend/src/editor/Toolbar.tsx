/** Панель инструментов редактора. */
import type { Editor } from '@tiptap/react'
import type { EditorMode } from '@/types'

const FONTS = ['Arial', 'Roboto', 'Times New Roman', 'Calibri', 'Courier New', 'Georgia']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72]
const HEADINGS = [
  { value: 'paragraph', label: 'Обычный текст' },
  { value: '1', label: 'Заголовок 1' },
  { value: '2', label: 'Заголовок 2' },
  { value: '3', label: 'Заголовок 3' },
  { value: '4', label: 'Заголовок 4' },
  { value: '5', label: 'Заголовок 5' },
  { value: '6', label: 'Заголовок 6' },
]

type Props = {
  editor: Editor | null
  mode: EditorMode
  onInsertImage: () => void
  onInsertLink: () => void
  onInsertTable: () => void
}

export function Toolbar({ editor, mode, onInsertImage, onInsertLink, onInsertTable }: Props) {
  if (!editor) return null

  const disabled = mode === 'viewing'

  const button = (
    label: string,
    title: string,
    onClick: () => void,
    active = false,
    extraClass = '',
  ) => (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={[
        'h-8 min-w-8 px-2 rounded text-sm transition-colors',
        'hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed',
        active ? 'bg-surface-muted font-semibold' : '',
        extraClass,
      ].join(' ')}
    >
      {label}
    </button>
  )

  const currentHeading = HEADINGS.slice(1).find((item) =>
    editor.isActive('heading', { level: Number(item.value) }),
  )

  return (
    <div
      role="toolbar"
      aria-label="Форматирование"
      className="flex flex-wrap items-center gap-1 border-b border-hairline bg-surface px-3 py-1.5 overflow-x-auto"
    >
      {button('↶', 'Отменить (Ctrl+Z)', () => editor.chain().focus().undo().run())}
      {button('↷', 'Повторить (Ctrl+Y)', () => editor.chain().focus().redo().run())}

      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />

      <select
        aria-label="Стиль текста"
        disabled={disabled}
        value={currentHeading?.value ?? 'paragraph'}
        onChange={(event) => {
          const value = event.target.value
          if (value === 'paragraph') editor.chain().focus().setParagraph().run()
          else
            editor
              .chain()
              .focus()
              .toggleHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 })
              .run()
        }}
        className="h-8 rounded border border-hairline bg-surface px-2 text-sm disabled:opacity-40"
      >
        {HEADINGS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Шрифт"
        disabled={disabled}
        onChange={(event) => editor.chain().focus().setFontFamily(event.target.value).run()}
        className="h-8 rounded border border-hairline bg-surface px-2 text-sm disabled:opacity-40"
      >
        {FONTS.map((font) => (
          <option key={font} value={font}>
            {font}
          </option>
        ))}
      </select>

      <select
        aria-label="Размер"
        disabled={disabled}
        defaultValue="12"
        onChange={(event) => {
          // Размер задаётся стилем: отдельного расширения под него нет,
          // а TextStyle сохраняет произвольные свойства.
          editor.chain().focus().setMark('textStyle', { fontSize: `${event.target.value}pt` }).run()
        }}
        className="h-8 w-16 rounded border border-hairline bg-surface px-2 text-sm disabled:opacity-40"
      >
        {SIZES.map((size) => (
          <option key={size} value={size}>
            {size}
          </option>
        ))}
      </select>

      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />

      {button('Ж', 'Полужирный (Ctrl+B)', () => editor.chain().focus().toggleBold().run(),
        editor.isActive('bold'), 'font-bold')}
      {button('К', 'Курсив (Ctrl+I)', () => editor.chain().focus().toggleItalic().run(),
        editor.isActive('italic'), 'italic')}
      {button('Ч', 'Подчёркнутый (Ctrl+U)', () => editor.chain().focus().toggleUnderline().run(),
        editor.isActive('underline'), 'underline')}
      {button('З', 'Зачёркнутый', () => editor.chain().focus().toggleStrike().run(),
        editor.isActive('strike'), 'line-through')}

      <input
        type="color"
        aria-label="Цвет текста"
        disabled={disabled}
        onChange={(event) => editor.chain().focus().setColor(event.target.value).run()}
        className="h-8 w-8 cursor-pointer rounded border border-hairline bg-surface disabled:opacity-40"
      />
      <input
        type="color"
        aria-label="Цвет выделения"
        disabled={disabled}
        onChange={(event) =>
          editor.chain().focus().toggleHighlight({ color: event.target.value }).run()
        }
        className="h-8 w-8 cursor-pointer rounded border border-hairline bg-surface disabled:opacity-40"
      />

      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />

      {button('⯇', 'По левому краю', () => editor.chain().focus().setTextAlign('left').run(),
        editor.isActive({ textAlign: 'left' }))}
      {button('⯅', 'По центру', () => editor.chain().focus().setTextAlign('center').run(),
        editor.isActive({ textAlign: 'center' }))}
      {button('⯈', 'По правому краю', () => editor.chain().focus().setTextAlign('right').run(),
        editor.isActive({ textAlign: 'right' }))}
      {button('☰', 'По ширине', () => editor.chain().focus().setTextAlign('justify').run(),
        editor.isActive({ textAlign: 'justify' }))}

      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />

      {button('•', 'Маркированный список', () => editor.chain().focus().toggleBulletList().run(),
        editor.isActive('bulletList'))}
      {button('1.', 'Нумерованный список', () => editor.chain().focus().toggleOrderedList().run(),
        editor.isActive('orderedList'))}
      {button('☑', 'Список задач', () => editor.chain().focus().toggleTaskList().run(),
        editor.isActive('taskList'))}
      {button('❝', 'Цитата', () => editor.chain().focus().toggleBlockquote().run(),
        editor.isActive('blockquote'))}

      <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />

      {button('🔗', 'Ссылка (Ctrl+K)', onInsertLink, editor.isActive('link'))}
      {button('🖼', 'Изображение', onInsertImage)}
      {button('▦', 'Таблица', onInsertTable)}
      {button('—', 'Разделитель', () => editor.chain().focus().setHorizontalRule().run())}
    </div>
  )
}
