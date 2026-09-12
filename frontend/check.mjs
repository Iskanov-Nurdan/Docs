// Проверка правил в том же виде, в каком их применяет таблица.
import { readFileSync, writeFileSync } from 'node:fs'

// TypeScript снимаем esbuild — он уже стоит вместе с Vite, и это честнее
// самодельной замены регулярками.
import { transformSync } from '/app/node_modules/esbuild/lib/main.js'

const source = readFileSync('/app/src/spreadsheet/statuses.ts', 'utf8')
writeFileSync('/tmp/statuses.mjs', transformSync(source, { loader: 'ts', format: 'esm' }).code)

const { statusTone, isDeadlineHeader, parseDeadline, deadlineTone, isSettled } =
  await import('/tmp/statuses.mjs')

console.log('--- слова на четырёх языках ---')
for (const word of ['Просрочка', 'Мөөнөтү өттү', 'Кечигүү', 'overdue', '逾期',
                    'Налог', 'Салык', 'tax', '税',
                    'В пути', 'Жолдо', 'Жөнөтүлдү', 'in transit', '在途',
                    'Готово', 'Даяр', 'delivered', '完成',
                    'Не оплачено', 'Отменён', 'Бишкек']) {
  const tone = statusTone(word)
  console.log(`  ${word.padEnd(14)} -> ${tone ? tone.label : 'без цвета'}`)
}

console.log('--- колонки со сроком ---')
for (const header of ['Прибытие', 'Срок', '到达', 'ETA', 'Дата', 'Машина'])
  console.log(`  ${header.padEnd(10)} -> ${isDeadlineHeader(header) ? 'срок' : 'обычная'}`)

console.log('--- время ---')
const now = new Date('2026-09-11T12:00:00')
for (const value of ['11.09.2026 10:00', '11.09.2026 13:30', '12.09.2026', '10:00', '18:00']) {
  const deadline = parseDeadline(value, now)
  const open = deadline ? deadlineTone(deadline, now, false) : null
  const closed = deadline ? deadlineTone(deadline, now, true) : null
  console.log(`  ${value.padEnd(18)} -> строка открыта: ${open ? open.label : 'без цвета'}`,
              `| строка закрыта: ${closed ? closed.label : 'без цвета'}`)
}

console.log('--- закрытая строка ---')
console.log('  ["01KG777", "Ош", "Готово"] ->', isSettled(['01KG777','Ош','Готово']))
console.log('  ["01KG777", "Ош", "В пути"] ->', isSettled(['01KG777','Ош','В пути']))
