/** Файлы таблиц, которые умеет разобрать сервер. */

const SHEET_EXTENSIONS = ['xlsx', 'xlsm', 'xls', 'csv']

/** Значение accept для поля выбора файла. */
export const SHEET_FILE_ACCEPT = SHEET_EXTENSIONS.map((extension) => `.${extension}`).join(',')

/**
 * Похож ли файл на таблицу — по расширению.
 *
 * Это только быстрый ответ человеку, перетащившему не тот файл: настоящий
 * формат сервер определяет по содержимому.
 */
export function isSheetFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return SHEET_EXTENSIONS.includes(extension)
}
