/**
 * Деньги в журнале: сомы на входе, доллары в таблице.
 *
 * Суммы называют в сомах — так их говорят водителю и так они приходят от
 * клиента. Считают и сверяют при этом в долларах. Поэтому введённое число
 * в колонке суммы пересчитывается сразу при вводе, а в ячейке остаётся
 * доллар со своим значком: два разных числа в одной колонке («тут сом, а тут
 * доллар») сверить нельзя никак.
 *
 * Пересчитывается только голое число. Написанное со значком доллара
 * («1200 $») уже в долларах — его оставляем как есть, иначе сумма
 * пересчиталась бы второй раз и уехала.
 */
import type * as Y from 'yjs'
import { applyStyle, findColumn, writeCell, type NumberFormat, type SheetMap } from './model'

/** Заголовки денежных колонок. Как и везде, сверка по началу заголовка. */
const COLUMNS = {
  amount: ['сумма', 'стоимость', 'цена', 'оплата', 'баасы', 'сом'],
  transit: ['транзит', 'transit'],
}

/** Что предлагается в колонке «Транзит», пока свой список не задан. */
export const TRANSIT_AMOUNTS = [200, 300, 500]

export const isAmountColumn = (sheet: SheetMap, col: number) =>
  findColumn(sheet, COLUMNS.amount) === col

export const isTransitColumn = (sheet: SheetMap, col: number) =>
  findColumn(sheet, COLUMNS.transit) === col

export const isMoneyColumn = (sheet: SheetMap, col: number) =>
  isAmountColumn(sheet, col) || isTransitColumn(sheet, col)

/** Итог записи: о пересчёте человеку нужно сказать, остальное молча. */
export type MoneyWrite =
  | { kind: 'converted'; som: number; usd: number; rate: number }
  | { kind: 'kept' }
  | { kind: 'no-rate'; som: number }

// Доллары узнаём по значку и словам: «1200 $», «1200 долл», «200 usd».
const IN_DOLLARS = /\$|usd|дол|доллар/i

/**
 * Число из набранного: «128 400», «128400,50», «1 200 $».
 *
 * Пробелы и неразрывные пробелы — разделители разрядов, запятая — дробная
 * часть: так число выглядит в таблице, и так же его набирают руками.
 */
export function parseAmount(text: string): number | null {
  const cleaned = text
    .replace(/[\s  ]/g, '')
    .replace(/[$]|usd|долларов|доллара|долл\.?|дол\.?|сом(ов|а)?/gi, '')
    .replace(',', '.')
  if (!cleaned || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null

  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

/** Сомы в доллары: копейки округляются, иначе в ячейке хвост из цифр. */
export const somToUsd = (som: number, rate: number) => Math.round((som / rate) * 100) / 100

/**
 * Запись в денежную колонку.
 *
 * Возвращает, что получилось: пересчёт нужно показать человеку — он ввёл
 * одно число, а в ячейке появилось другое, и это не должно выглядеть
 * как своевольная правка.
 */
export function writeMoney(
  doc: Y.Doc,
  sheet: SheetMap,
  row: number,
  col: number,
  raw: string,
  rate: number | null,
): MoneyWrite {
  const text = raw.trim()

  // Формулу и пустую ячейку не трогаем: там считает сам редактор.
  if (!text || text.startsWith('=')) {
    writeCell(doc, sheet, row, col, raw)
    return { kind: 'kept' }
  }

  const amount = parseAmount(text)
  if (amount === null) {
    // Не число — пусть остаётся как набрано: в сумме пишут и «по договору».
    writeCell(doc, sheet, row, col, raw)
    return { kind: 'kept' }
  }

  // Транзит выбирают из списка, он уже в долларах.
  if (isTransitColumn(sheet, col) || IN_DOLLARS.test(text)) {
    put(doc, sheet, row, col, amount, 'currency_usd')
    return { kind: 'kept' }
  }

  if (rate === null) {
    // Курса нет — оставляем сомы и помечаем их сомами, чтобы число
    // не выглядело долларами. Пересчитать можно будет потом.
    put(doc, sheet, row, col, amount, 'currency_kgs')
    return { kind: 'no-rate', som: amount }
  }

  const usd = somToUsd(amount, rate)
  put(doc, sheet, row, col, usd, 'currency_usd')
  return { kind: 'converted', som: amount, usd, rate }
}

/**
 * Число и значок валюты — одной правкой.
 *
 * Иначе Ctrl+Z отменял бы их по очереди: сначала значок, потом сумму. Для
 * человека пересчёт — одно действие, и отменяться он должен так же.
 */
function put(doc: Y.Doc, sheet: SheetMap, row: number, col: number,
             value: number, format: NumberFormat): void {
  doc.transact(() => {
    writeCell(doc, sheet, row, col, String(value))
    applyStyle(doc, sheet, [{ row, col }], { format })
  })
}
