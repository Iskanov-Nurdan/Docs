/**
 * Вычислитель формул.
 *
 * Разбор идёт в два прохода: строка режется на лексемы, затем рекурсивный
 * спуск строит и сразу считает выражение. Отдельного дерева нет намеренно —
 * пересчёт всегда идёт от исходной строки, а промежуточные значения ячеек
 * кеширует Evaluator, так что второе дерево ничего бы не сэкономило.
 *
 * Ссылки на ячейки разрешаются через обратный вызов: вычислитель ничего не
 * знает ни о Yjs, ни о том, как устроено хранение листа.
 */

export type CellValue = number | string | boolean | null

/**
 * Границы листа. Лежат здесь, а не в модели, потому что нужны разбору адресов:
 * без них «=СУММ(A2:ZZZ99999)» разворачивался в полтора миллиарда значений и
 * укладывал вкладку каждого, кто откроет документ.
 */
export const MAX_ROWS = 5000
export const MAX_COLS = 100

/**
 * Потолок на размер диапазона внутри одной функции.
 *
 * Лист целиком — полмиллиона клеток; столько складывать никто не просит, а
 * пересчёт идёт в основном потоке и на это время окно замирает.
 */
const MAX_RANGE_CELLS = 50_000

/** Ошибки записываются в ячейку как значения — так же, как в любой таблице. */
export const ERRORS = {
  div: '#ДЕЛ/0!',
  value: '#ЗНАЧ!',
  name: '#ИМЯ?',
  ref: '#ССЫЛКА!',
  cycle: '#ЦИКЛ!',
  num: '#ЧИСЛО!',
  na: '#Н/Д',
} as const

const ERROR_SET = new Set<string>(Object.values(ERRORS))

export function isError(value: CellValue): boolean {
  return typeof value === 'string' && ERROR_SET.has(value)
}

/** Ошибка вычисления. Ловится на верхнем уровне и становится значением. */
class FormulaError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

// --------------------------------- Адреса ---------------------------------

export function colLabel(col: number): string {
  let label = ''
  let rest = col
  while (rest >= 0) {
    label = String.fromCharCode(65 + (rest % 26)) + label
    rest = Math.floor(rest / 26) - 1
  }
  return label
}

export function colIndex(label: string): number {
  let index = 0
  for (const char of label.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64)
  }
  return index - 1
}

export function cellRef(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`
}

/**
 * Разбирает адрес ячейки. null — адреса за пределами листа тоже сюда.
 *
 * Проверка границ именно здесь, а не у вызывающих: адрес приходит и из
 * формулы, и из сохранённого содержимого, и «A100000000» в любом из этих
 * мест разворачивался в сетку, которой не хватало памяти.
 */
export function parseRef(ref: string): { row: number; col: number } | null {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim())
  if (!match) return null

  // Больше семи цифр Number ещё разберёт, но такой строки на листе нет.
  if (match[2].length > 7 || match[1].length > 4) return null

  const row = Number(match[2]) - 1
  const col = colIndex(match[1])
  if (row < 0 || row >= MAX_ROWS) return null
  if (col < 0 || col >= MAX_COLS) return null
  return { row, col }
}

// -------------------------------- Лексемы --------------------------------

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'ref'; value: string }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'name'; value: string }
  | { kind: 'op'; value: string }
  | { kind: 'paren'; value: '(' | ')' }
  | { kind: 'comma' }
  | { kind: 'error'; value: string }

// «%» стоит в списке наравне с остальными: без него разбор процента был
// недостижимым кодом, а «=B1*10%» отвечал «#ЗНАЧ!».
const OPERATORS = ['<>', '<=', '>=', '+', '-', '*', '/', '^', '&', '=', '<', '>', '%']

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (char === ' ' || char === '\t') {
      index += 1
      continue
    }

    if (char === '"') {
      // Кавычка внутри строки удваивается, как принято в табличных формулах.
      // Прежняя проверка стояла внутри цикла «пока символ не кавычка» и
      // поэтому не срабатывала никогда: =СЦЕПИТЬ("Он сказал ""да""") падало.
      let text = ''
      let closed = false
      index += 1

      while (index < source.length) {
        if (source[index] === '"') {
          if (source[index + 1] === '"') {
            text += '"'
            index += 2
            continue
          }
          index += 1
          closed = true
          break
        }
        text += source[index]
        index += 1
      }

      if (!closed) throw new FormulaError(ERRORS.value)
      tokens.push({ kind: 'string', value: text })
      continue
    }

    // Ошибка, записанная в саму формулу: так выглядит ссылка на строку,
    // которую удалили. Разбирается как значение, чтобы ЕСЛИОШИБКА её поймала.
    if (char === '#') {
      const code = Object.values(ERRORS).find((item) => source.startsWith(item, index))
      if (!code) throw new FormulaError(ERRORS.value)
      index += code.length
      tokens.push({ kind: 'error', value: code })
      continue
    }

    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', value: char })
      index += 1
      continue
    }

    if (char === ',' || char === ';') {
      tokens.push({ kind: 'comma' })
      index += 1
      continue
    }

    const operator = OPERATORS.find((item) => source.startsWith(item, index))
    if (operator) {
      tokens.push({ kind: 'op', value: operator })
      index += operator.length
      continue
    }

    if (/[0-9.]/.test(char)) {
      const match = /^\d*\.?\d+([eE][+-]?\d+)?/.exec(source.slice(index))
      if (!match) throw new FormulaError(ERRORS.value)
      tokens.push({ kind: 'number', value: Number(match[0]) })
      index += match[0].length
      continue
    }

    if (/[A-Za-zА-Яа-яЁё_$]/.test(char)) {
      // Ё и ё вне диапазона А-Я, поэтому перечислены отдельно: без них
      // СЧЁТ и СЧЁТЕСЛИ не распознавались.
      const match = /^[A-Za-zА-Яа-яЁё_$][A-Za-zА-Яа-яЁё0-9_.$]*/.exec(source.slice(index))
      if (!match) throw new FormulaError(ERRORS.name)
      const word = match[0]
      index += word.length

      // Диапазон распознаём здесь: двоеточие связывает две ссылки в одну
      // лексему, иначе разбор выражения принял бы его за оператор.
      if (source[index] === ':' && parseRef(word)) {
        const next = /^[A-Za-z$]+\$?\d+/.exec(source.slice(index + 1))
        if (next && parseRef(next[0])) {
          index += 1 + next[0].length
          tokens.push({ kind: 'range', from: word, to: next[0] })
          continue
        }
      }

      if (parseRef(word)) tokens.push({ kind: 'ref', value: word })
      else tokens.push({ kind: 'name', value: word.toUpperCase() })
      continue
    }

    throw new FormulaError(ERRORS.value)
  }

  return tokens
}

// ------------------------------ Приведение типов ------------------------------

function toNumber(value: CellValue): number {
  if (value === null || value === '') return 0
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 1 : 0
  if (isError(value)) throw new FormulaError(value)

  const text = value.trim().replace(',', '.')
  const parsed = Number(text)
  if (Number.isNaN(parsed)) throw new FormulaError(ERRORS.value)
  return finite(parsed)
}

/**
 * Результат, который нельзя показать числом, — это ошибка, а не «∞».
 *
 * Бесконечность и NaN раньше доезжали до ячейки и печатались как «∞ ₽» или
 * «не число», а дальше складывались с соседями и отравляли итог.
 */
function finite(value: number): number {
  if (!Number.isFinite(value)) throw new FormulaError(ERRORS.num)
  return value
}

function toText(value: CellValue): string {
  if (value === null) return ''
  if (typeof value === 'boolean') return value ? 'ИСТИНА' : 'ЛОЖЬ'
  return String(value)
}

function toBoolean(value: CellValue): boolean {
  if (typeof value === 'boolean') return value
  if (value === null || value === '') return false
  if (typeof value === 'number') return value !== 0
  if (isError(value)) throw new FormulaError(value)
  const text = value.trim().toUpperCase()
  if (text === 'ИСТИНА' || text === 'TRUE') return true
  if (text === 'ЛОЖЬ' || text === 'FALSE') return false
  return true
}

/** Значение аргумента: одиночное или развёрнутый диапазон. */
type Argument = { list: CellValue[] }

function single(values: Argument): CellValue {
  return values.list.length ? values.list[0] : null
}

// -------------------------------- Функции --------------------------------

type FunctionImpl = (args: Argument[]) => CellValue

const numbersOf = (args: Argument[]): number[] => {
  const result: number[] = []
  for (const arg of args) {
    for (const item of arg.list) {
      if (item === null || item === '') continue
      if (isError(item as CellValue)) throw new FormulaError(item as string)
      // Текст внутри диапазона пропускаем: так ведут себя СУММ и СРЗНАЧ.
      if (typeof item === 'string' && Number.isNaN(Number(item.replace(',', '.')))) continue
      result.push(toNumber(item))
    }
  }
  return result
}

const round = (value: number, digits: number) => {
  // Знаков после запятой в числе с плавающей точкой всё равно не больше
  // пятнадцати: при 400 множитель становился бесконечностью, а результат NaN.
  const places = Math.min(Math.max(Math.trunc(digits), -15), 15)
  const factor = 10 ** places
  return finite(Math.round((finite(value) + Number.EPSILON) * factor) / factor)
}

/** Сравнение для СЧЁТЕСЛИ и СУММЕСЛИ: «>10», «<>нет», «яблоко». */
function matches(value: CellValue, criterion: CellValue): boolean {
  const text = toText(criterion).trim()
  const operator = ['<>', '<=', '>=', '<', '>', '='].find((item) => text.startsWith(item))

  if (!operator) {
    const asNumber = Number(text.replace(',', '.'))
    if (text !== '' && !Number.isNaN(asNumber) && typeof value === 'number') {
      return value === asNumber
    }
    return toText(value).toLowerCase() === text.toLowerCase()
  }

  const operand = text.slice(operator.length).trim()
  const asNumber = Number(operand.replace(',', '.'))

  if (!Number.isNaN(asNumber) && operand !== '') {
    const left = typeof value === 'number' ? value : Number(toText(value).replace(',', '.'))
    if (Number.isNaN(left)) return operator === '<>'
    switch (operator) {
      case '<>': return left !== asNumber
      case '<=': return left <= asNumber
      case '>=': return left >= asNumber
      case '<': return left < asNumber
      case '>': return left > asNumber
      default: return left === asNumber
    }
  }

  const left = toText(value).toLowerCase()
  const right = operand.toLowerCase()
  return operator === '<>' ? left !== right : left === right
}

const FUNCTIONS: Record<string, FunctionImpl> = {
  СУММ: (args) => finite(numbersOf(args).reduce((sum, item) => sum + item, 0)),
  СРЗНАЧ: (args) => {
    const numbers = numbersOf(args)
    if (!numbers.length) throw new FormulaError(ERRORS.div)
    return numbers.reduce((sum, item) => sum + item, 0) / numbers.length
  },
  МИН: (args) => {
    const numbers = numbersOf(args)
    return numbers.length ? Math.min(...numbers) : 0
  },
  МАКС: (args) => {
    const numbers = numbersOf(args)
    return numbers.length ? Math.max(...numbers) : 0
  },
  СЧЁТ: (args) => numbersOf(args).length,
  СЧЁТЗ: (args) =>
    args.reduce(
      (count, arg) => count + arg.list.filter((item) => item !== null && item !== '').length,
      0,
    ),
  ПРОИЗВЕД: (args) => finite(numbersOf(args).reduce((product, item) => product * item, 1)),
  МЕДИАНА: (args) => {
    const numbers = numbersOf(args).sort((left, right) => left - right)
    if (!numbers.length) throw new FormulaError(ERRORS.num)
    const middle = Math.floor(numbers.length / 2)
    return numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2
  },
  ОКРУГЛ: (args) => round(toNumber(single(args[0])), args[1] ? toNumber(single(args[1])) : 0),
  ABS: (args) => Math.abs(toNumber(single(args[0]))),
  КОРЕНЬ: (args) => {
    const value = toNumber(single(args[0]))
    if (value < 0) throw new FormulaError(ERRORS.num)
    return Math.sqrt(value)
  },
  СТЕПЕНЬ: (args) => {
    const result = toNumber(single(args[0])) ** toNumber(single(args[1]))
    // Корень нечётной степени из отрицательного даёт NaN, а не число.
    if (Number.isNaN(result)) throw new FormulaError(ERRORS.num)
    return finite(result)
  },
  ОСТАТ: (args) => {
    const divisor = toNumber(single(args[1]))
    if (divisor === 0) throw new FormulaError(ERRORS.div)
    return finite(toNumber(single(args[0])) % divisor)
  },
  И: (args) => args.every((arg) => arg.list.every((item) => toBoolean(item))),
  ИЛИ: (args) => args.some((arg) => arg.list.some((item) => toBoolean(item))),
  НЕ: (args) => !toBoolean(single(args[0])),
  СЦЕПИТЬ: (args) =>
    args.map((arg) => arg.list.map((item) => toText(item)).join('')).join(''),
  ДЛСТР: (args) => toText(single(args[0])).length,
  ПРОПИСН: (args) => toText(single(args[0])).toUpperCase(),
  СТРОЧН: (args) => toText(single(args[0])).toLowerCase(),
  СЖПРОБЕЛЫ: (args) => toText(single(args[0])).trim().replace(/\s+/g, ' '),
  ЛЕВСИМВ: (args) =>
    toText(single(args[0])).slice(0, args[1] ? toNumber(single(args[1])) : 1),
  ПРАВСИМВ: (args) => {
    const count = args[1] ? toNumber(single(args[1])) : 1
    const text = toText(single(args[0]))
    return count >= text.length ? text : text.slice(text.length - count)
  },
  ПСТР: (args) => {
    const start = toNumber(single(args[1]))
    return toText(single(args[0])).slice(start - 1, start - 1 + toNumber(single(args[2])))
  },
  СЧЁТЕСЛИ: (args) => {
    const criterion = single(args[1])
    return args[0].list.filter((item) => matches(item, criterion)).length
  },
  СУММЕСЛИ: (args) => {
    const criterion = single(args[1])
    const source = args[2] ? args[2].list : args[0].list
    return args[0].list.reduce<number>((sum, item, position) => {
      if (!matches(item, criterion)) return sum
      const target = source[position]
      if (target === null || target === undefined) return sum
      return sum + toNumber(target)
    }, 0)
  },
  СЕГОДНЯ: () => new Date().toLocaleDateString('ru-RU'),
  ТДАТА: () => new Date().toLocaleString('ru-RU'),
}

/** Аргумент, ещё не посчитанный: вычисляется только когда действительно нужен. */
type Lazy = () => Argument

/**
 * Функции, которые сами решают, какие аргументы считать.
 *
 * Ради них и заведён отдельный список. Раньше аргументы вычислялись до вызова
 * функции, и ошибка из первого улетала мимо: =ЕСЛИОШИБКА(1/0;"запасное")
 * отвечало «#ДЕЛ/0!», то есть единственное, ради чего эту функцию пишут, не
 * работало. То же с =ЕСЛИ(C1=0;0;B1/C1) — защищённая ветка всё равно делилась.
 */
const LAZY_FUNCTIONS: Record<string, (args: Lazy[]) => CellValue> = {
  ЕСЛИОШИБКА: (args) => {
    if (args.length < 2) throw new FormulaError(ERRORS.value)
    try {
      const value = single(args[0]())
      return isError(value) ? single(args[1]()) : value
    } catch (error) {
      if (error instanceof FormulaError) return single(args[1]())
      throw error
    }
  },
  ЕСЛИ: (args) => {
    if (args.length < 2) throw new FormulaError(ERRORS.value)
    const condition = toBoolean(single(args[0]()))
    if (condition) return single(args[1]())
    return args.length > 2 ? single(args[2]()) : false
  },
}

// Английские имена принимаются наравне с русскими: формулы часто переносят
// из других таблиц, и переписывать их вручную никто не станет.
const ALIASES: Record<string, string> = {
  SUM: 'СУММ', AVERAGE: 'СРЗНАЧ', MIN: 'МИН', MAX: 'МАКС', COUNT: 'СЧЁТ',
  COUNTA: 'СЧЁТЗ', PRODUCT: 'ПРОИЗВЕД', MEDIAN: 'МЕДИАНА', ROUND: 'ОКРУГЛ',
  SQRT: 'КОРЕНЬ', POWER: 'СТЕПЕНЬ', MOD: 'ОСТАТ', IF: 'ЕСЛИ',
  IFERROR: 'ЕСЛИОШИБКА', AND: 'И', OR: 'ИЛИ', NOT: 'НЕ',
  CONCAT: 'СЦЕПИТЬ', CONCATENATE: 'СЦЕПИТЬ', LEN: 'ДЛСТР', UPPER: 'ПРОПИСН',
  LOWER: 'СТРОЧН', TRIM: 'СЖПРОБЕЛЫ', LEFT: 'ЛЕВСИМВ', RIGHT: 'ПРАВСИМВ',
  MID: 'ПСТР', COUNTIF: 'СЧЁТЕСЛИ', SUMIF: 'СУММЕСЛИ', TODAY: 'СЕГОДНЯ',
  NOW: 'ТДАТА', СЧET: 'СЧЁТ',
}

/** Имена функций для подсказки в интерфейсе. */
export const FUNCTION_NAMES = [
  ...Object.keys(FUNCTIONS),
  ...Object.keys(LAZY_FUNCTIONS),
].sort()

// -------------------------------- Разбор --------------------------------

class Parser {
  private position = 0

  constructor(
    private readonly tokens: Token[],
    private readonly resolve: (row: number, col: number) => CellValue,
  ) {}

  parse(): CellValue {
    const value = this.comparison()
    if (this.position < this.tokens.length) throw new FormulaError(ERRORS.value)
    return value
  }

  private peek(): Token | undefined {
    return this.tokens[this.position]
  }

  private comparison(): CellValue {
    let left = this.concat()

    for (;;) {
      const token = this.peek()
      if (token?.kind !== 'op') break
      if (!['=', '<>', '<', '>', '<=', '>='].includes(token.value)) break
      this.position += 1
      const right = this.concat()
      left = compare(token.value, left, right)
    }

    return left
  }

  private concat(): CellValue {
    let left = this.additive()

    while (this.peek()?.kind === 'op' && (this.peek() as { value: string }).value === '&') {
      this.position += 1
      left = toText(left) + toText(this.additive())
    }

    return left
  }

  private additive(): CellValue {
    let left = this.multiplicative()

    for (;;) {
      const token = this.peek()
      if (token?.kind !== 'op' || (token.value !== '+' && token.value !== '-')) break
      this.position += 1
      const right = toNumber(this.multiplicative())
      left = finite(token.value === '+' ? toNumber(left) + right : toNumber(left) - right)
    }

    return left
  }

  private multiplicative(): CellValue {
    let left = this.power()

    for (;;) {
      const token = this.peek()
      if (token?.kind !== 'op' || (token.value !== '*' && token.value !== '/')) break
      this.position += 1
      const right = toNumber(this.power())
      if (token.value === '/' && right === 0) throw new FormulaError(ERRORS.div)
      left = finite(token.value === '*' ? toNumber(left) * right : toNumber(left) / right)
    }

    return left
  }

  private power(): CellValue {
    const base = this.unary()
    const token = this.peek()
    if (token?.kind === 'op' && token.value === '^') {
      this.position += 1
      const result = toNumber(base) ** toNumber(this.power())
      if (Number.isNaN(result)) throw new FormulaError(ERRORS.num)
      return finite(result)
    }
    return base
  }

  private unary(): CellValue {
    const token = this.peek()
    if (token?.kind === 'op' && (token.value === '-' || token.value === '+')) {
      this.position += 1
      const value = toNumber(this.unary())
      return token.value === '-' ? -value : value
    }
    return this.postfix(this.primary())
  }

  /** Процент: «50%» — это 0,5, и работает он после любого значения. */
  private postfix(value: CellValue): CellValue {
    let result = value
    for (;;) {
      const token = this.peek()
      if (token?.kind !== 'op' || token.value !== '%') return result
      this.position += 1
      result = toNumber(result) / 100
    }
  }

  private primary(): CellValue {
    const token = this.peek()
    if (!token) throw new FormulaError(ERRORS.value)

    if (token.kind === 'number') {
      this.position += 1
      return token.value
    }

    if (token.kind === 'string') {
      this.position += 1
      return token.value
    }

    if (token.kind === 'error') {
      this.position += 1
      throw new FormulaError(token.value)
    }

    if (token.kind === 'ref') {
      this.position += 1
      const address = parseRef(token.value)
      if (!address) throw new FormulaError(ERRORS.ref)
      return this.resolve(address.row, address.col)
    }

    if (token.kind === 'range') {
      // Диапазон вне функции значения не имеет: складывать его не с чем.
      throw new FormulaError(ERRORS.value)
    }

    if (token.kind === 'paren' && token.value === '(') {
      this.position += 1
      const value = this.comparison()
      const closing = this.peek()
      if (closing?.kind !== 'paren' || closing.value !== ')') throw new FormulaError(ERRORS.value)
      this.position += 1
      return value
    }

    if (token.kind === 'name') {
      this.position += 1
      const name = ALIASES[token.value] ?? token.value

      if (name === 'ИСТИНА' || name === 'TRUE') return true
      if (name === 'ЛОЖЬ' || name === 'FALSE') return false

      const lazy = LAZY_FUNCTIONS[name]
      const implementation = FUNCTIONS[name]
      if (!lazy && !implementation) throw new FormulaError(ERRORS.name)

      const opening = this.peek()
      if (opening?.kind !== 'paren' || opening.value !== '(') throw new FormulaError(ERRORS.name)
      this.position += 1

      const spans = this.argumentSpans()
      if (lazy) return lazy(spans.map((span) => () => this.evaluateSpan(span)))
      return implementation(spans.map((span) => this.evaluateSpan(span)))
    }

    throw new FormulaError(ERRORS.value)
  }

  /**
   * Границы аргументов в потоке лексем — сами аргументы при этом не считаются.
   *
   * Нужны ЕСЛИ и ЕСЛИОШИБКА: считать аргумент можно только после того, как
   * стало понятно, что он вообще понадобится. Разделители ищутся на нулевой
   * глубине скобок, иначе «=ЕСЛИ(A1;СУММ(B1;C1);0)» распалось бы на четыре
   * аргумента вместо трёх.
   */
  private argumentSpans(): Array<{ from: number; to: number }> {
    const spans: Array<{ from: number; to: number }> = []

    const next = this.peek()
    if (next?.kind === 'paren' && next.value === ')') {
      this.position += 1
      return spans
    }

    let depth = 0
    let from = this.position

    for (;;) {
      const token = this.tokens[this.position]
      if (!token) throw new FormulaError(ERRORS.value)

      if (token.kind === 'paren' && token.value === '(') {
        depth += 1
      } else if (token.kind === 'paren' && token.value === ')') {
        if (depth === 0) {
          spans.push({ from, to: this.position })
          this.position += 1
          break
        }
        depth -= 1
      } else if (token.kind === 'comma' && depth === 0) {
        spans.push({ from, to: this.position })
        this.position += 1
        from = this.position
        continue
      }

      this.position += 1
    }

    // Пустой аргумент — «=СУММ(A1;)» — это опечатка, а не ноль.
    for (const span of spans) {
      if (span.from === span.to) throw new FormulaError(ERRORS.value)
    }
    return spans
  }

  /** Считает один аргумент по его границам, не сбивая текущую позицию. */
  private evaluateSpan(span: { from: number; to: number }): Argument {
    const saved = this.position
    this.position = span.from
    try {
      const value = this.argument()
      if (this.position !== span.to) throw new FormulaError(ERRORS.value)
      return value
    } finally {
      this.position = saved
    }
  }

  private argument(): Argument {
    const token = this.peek()

    if (token?.kind === 'range') {
      this.position += 1
      const from = parseRef(token.from)
      const to = parseRef(token.to)
      if (!from || !to) throw new FormulaError(ERRORS.ref)

      const list: CellValue[] = []
      const rowFrom = Math.min(from.row, to.row)
      const rowTo = Math.max(from.row, to.row)
      const colFrom = Math.min(from.col, to.col)
      const colTo = Math.max(from.col, to.col)

      // Диапазон уже ограничен размером листа — parseRef дальше него не пускает.
      // Здесь отсекается второе: узкая, но очень длинная выборка на весь лист.
      const cells = (rowTo - rowFrom + 1) * (colTo - colFrom + 1)
      if (cells > MAX_RANGE_CELLS) throw new FormulaError(ERRORS.num)

      for (let row = rowFrom; row <= rowTo; row += 1) {
        for (let col = colFrom; col <= colTo; col += 1) {
          list.push(this.resolve(row, col))
        }
      }
      return { list }
    }

    return { list: [this.comparison()] }
  }
}

function compare(operator: string, left: CellValue, right: CellValue): boolean {
  const bothNumeric = typeof left === 'number' && typeof right === 'number'
  const a: CellValue = bothNumeric ? left : toText(left).toLowerCase()
  const b: CellValue = bothNumeric ? right : toText(right).toLowerCase()

  switch (operator) {
    case '=': return a === b
    case '<>': return a !== b
    case '<': return a < b
    case '>': return a > b
    case '<=': return a <= b
    case '>=': return a >= b
    default: throw new FormulaError(ERRORS.value)
  }
}

// ------------------------------- Вычислитель -------------------------------

/**
 * Считает значения ячеек листа.
 *
 * Экземпляр живёт один пересчёт: результаты кешируются, поэтому ячейка,
 * на которую ссылаются десять формул, вычисляется один раз. Цикл ловится
 * набором «сейчас в работе» — без него ссылка на саму себя зациклила бы вкладку.
 */
export class Evaluator {
  private readonly cache = new Map<string, CellValue>()
  private readonly visiting = new Set<string>()

  constructor(private readonly getRaw: (row: number, col: number) => string | null) {}

  valueAt(row: number, col: number): CellValue {
    if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) return ERRORS.ref

    const key = `${row}:${col}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached

    if (this.visiting.has(key)) return ERRORS.cycle
    this.visiting.add(key)

    let result: CellValue
    try {
      result = this.compute(this.getRaw(row, col))
    } finally {
      this.visiting.delete(key)
    }

    this.cache.set(key, result)
    return result
  }

  /** Разбирает введённое: формула, число или обычный текст. */
  private compute(raw: string | null): CellValue {
    if (raw === null || raw === '') return null

    if (!raw.startsWith('=')) return parseLiteral(raw)

    try {
      const tokens = tokenize(raw.slice(1))
      if (!tokens.length) return null
      return new Parser(tokens, (row, col) => this.valueAt(row, col)).parse()
    } catch (error) {
      if (error instanceof FormulaError) return error.code
      return ERRORS.value
    }
  }
}

/** Значение без формулы: число, процент, логическое или строка как есть. */
export function parseLiteral(raw: string): CellValue {
  const text = raw.trim()
  if (text === '') return ''

  const upper = text.toUpperCase()
  if (upper === 'ИСТИНА' || upper === 'TRUE') return true
  if (upper === 'ЛОЖЬ' || upper === 'FALSE') return false

  if (text.endsWith('%')) {
    const percent = numberFrom(text.slice(0, -1))
    if (percent !== null) return percent / 100
  }

  const number = numberFrom(text)
  return number === null ? raw : number
}

/**
 * Число из набранного человеком, или null, если это всё-таки текст.
 *
 * Три правила появились из-за того, что набирают в этих таблицах:
 *
 * Пробел считается разделителем разрядов только в правильных группах по три
 * цифры. Иначе «7 900 123 45 67» превращался в 79001234567, и телефон
 * переставал быть телефоном, а «10 20» становилось числом 1020.
 *
 * Ведущий ноль оставляет текст текстом: «007» и «0123» — это номера накладных
 * и счетов, и потеря нуля делает их чужими.
 *
 * Бесконечность числом не считается: «1e400» — это уже не значение.
 */
function numberFrom(source: string): number | null {
  const text = source.trim()
  if (text === '') return null

  const grouped = /^[+-]?\d{1,3}(?: \d{3})+(?:[.,]\d+)?$/.test(text)
  const plain = /^[+-]?\d+(?:[.,]\d+)?(?:[eE][+-]?\d+)?$/.test(text)
  if (!grouped && !plain) return null

  if (/^[+-]?0\d/.test(text)) return null

  const value = Number(text.replace(/ /g, '').replace(',', '.'))
  return Number.isFinite(value) ? value : null
}
