/**
 * Список выбора в ячейке: что показать по набранному и что запишет Enter.
 *
 * Вынесено из сетки отдельно: правило «что запишется» должно быть одно для
 * сетки и для проверок — ошибка в нём молча меняет данные («20» → «200 $»).
 */

/** Текст варианта для сравнения с набранным: без регистра и «ё». */
export const foldChoice = (text: string) => text.trim().toLowerCase().replace(/ё/g, 'е')

/**
 * Варианты по набранному: «таш» оставляет «Ташкент», «ош» — «Ош» и «Ошская
 * обл.». Точное совпадение первым, потом то, что начинается с набранного,
 * потом то, где оно внутри. Пока ничего не набрали — весь список.
 */
export function filterChoices(choices: string[], value: string, typed: boolean): string[] {
  const needle = foldChoice(value)
  if (!typed || !needle) return choices

  // Точное совпадение — первым: набрали «Ош», а «Ошская обл.» стояла бы
  // выше только потому, что тоже начинается на «ош».
  const exact: string[] = []
  const starts: string[] = []
  const inside: string[] = []
  for (const choice of choices) {
    const folded = foldChoice(choice)
    if (folded === needle) exact.push(choice)
    else if (folded.startsWith(needle)) starts.push(choice)
    else if (folded.includes(needle)) inside.push(choice)
  }
  return [...exact, ...starts, ...inside]
}

/**
 * Какой вариант подсветить сразу, чтобы его записал Enter. -1 — Enter
 * запишет набранное как есть.
 *
 * Подсвечиваем сами, только когда ошибиться нельзя:
 *  • набранное точно есть в списке («Ош») — оно и подсвечено;
 *  • набраны буквы, и есть вариант, который с них начинается («таш» →
 *    «Ташкент») — подставить его и есть смысл подсказки.
 * Цифры сами не подменяются: «20» — это двадцать, а не «200 $» из списка.
 * Совпадение внутри слова («ала» в «Талас») тоже: это уже догадка.
 * Остальное выбирают стрелкой ↓ или щелчком.
 */
export function autoPick(shown: string[], value: string, typed: boolean): number {
  const needle = typed ? foldChoice(value) : ''
  const first = shown[0]
  if (!needle || first === undefined) return -1
  const folded = foldChoice(first)
  if (folded === needle) return 0
  const letters = /\p{L}/u.test(needle) && !/\d/.test(needle)
  return letters && folded.startsWith(needle) ? 0 : -1
}
