/**
 * Цвет ячейки по смыслу: статус словом и срок временем.
 *
 * В журнале рейсов важно не читать таблицу, а видеть её. Поэтому цвет берётся
 * из двух источников и оба работают сами:
 *
 * 1. **слово** — «просрочка», «налог», «在途», «overdue». Люди пишут на трёх
 *    языках вперемешку, поэтому слова собраны все вместе, а не по языкам:
 *    таблице всё равно, на чём набрали, ей важен смысл;
 * 2. **время** — колонка со сроком («Прибытие», «Срок», «到达»). Когда время
 *    прошло, ячейка краснеет сама, без чьей-либо правки. Это и есть просрочка:
 *    груз должен был прийти, а строка ещё не закрыта.
 *
 * Закрытая строка не краснеет: если в ней стоит «Готово» или «Прибыл», срок
 * уже неважен — рейс приехал, пусть и позже обещанного.
 *
 * Ручная заливка сильнее любой подсказки: её выбрал человек.
 */
export type ToneKind = 'overdue' | 'soon' | 'tax' | 'progress' | 'waiting' | 'done' | 'cancelled'

export type StatusTone = {
  kind: ToneKind
  label: string
  /** Светлая заливка: поверх неё читается тёмный текст. */
  background: string
  color: string
  /** Тёмная тема: светлая плашка на тёмном листе слепит. */
  darkBackground: string
  darkColor: string
}

const OVERDUE: StatusTone = {
  kind: 'overdue',
  label: 'Просрочка',
  background: '#fee2e2',
  color: '#991b1b',
  darkBackground: '#7f1d1d',
  darkColor: '#fecaca',
}

/** Срок ещё не вышел, но вот-вот: жёлтый предупреждает, красный уже поздно. */
const SOON: StatusTone = {
  kind: 'soon',
  label: 'Скоро срок',
  background: '#fef3c7',
  color: '#92400e',
  darkBackground: '#78350f',
  darkColor: '#fde68a',
}

const TAX: StatusTone = {
  kind: 'tax',
  label: 'Налог',
  background: '#ffedd5',
  color: '#9a3412',
  darkBackground: '#7c2d12',
  darkColor: '#fed7aa',
}

const PROGRESS: StatusTone = {
  kind: 'progress',
  label: 'В пути',
  background: '#dbeafe',
  color: '#1e40af',
  darkBackground: '#1e3a8a',
  darkColor: '#bfdbfe',
}

const WAITING: StatusTone = {
  kind: 'waiting',
  label: 'Ожидание',
  background: '#fef9c3',
  color: '#854d0e',
  darkBackground: '#713f12',
  darkColor: '#fef08a',
}

const DONE: StatusTone = {
  kind: 'done',
  label: 'Готово',
  background: '#dcfce7',
  color: '#166534',
  darkBackground: '#14532d',
  darkColor: '#bbf7d0',
}

const CANCELLED: StatusTone = {
  kind: 'cancelled',
  label: 'Отменён',
  background: '#e5e7eb',
  color: '#374151',
  darkBackground: '#374151',
  darkColor: '#e5e7eb',
}

/**
 * Начала слов, по которым узнаётся статус: русский, кыргызский, английский
 * и китайский вперемешку.
 *
 * Порядок важен: проверка идёт сверху вниз, и «не оплачено» должно сработать
 * раньше «оплачено», иначе долг покрасится зелёным.
 */
const RULES: { starts: string[]; tone: StatusTone }[] = [
  {
    tone: OVERDUE,
    starts: [
      'не оплач', 'неоплач', 'долг', 'просроч', 'опозда', 'авари', 'срочно',
      'толонгон эмес', 'карыз', 'моонот', 'кечиг', 'кечик',
      'overdue', 'unpaid', 'debt', 'late', 'delay',
      '逾期', '欠款', '未付', '延误', '迟到',
    ],
  },
  {
    tone: TAX,
    starts: [
      'налог', 'пошлин', 'ндс', 'штраф', 'таможн', 'сбор',
      'салык', 'бажы', 'айып',
      'tax', 'duty', 'vat', 'customs', 'fine',
      '税', '关税', '增值税', '罚款', '海关',
    ],
  },
  {
    tone: PROGRESS,
    starts: [
      'в пути', 'выехал', 'вышел', 'везет', 'в дороге', 'погруз', 'отправл',
      'жолдо', 'чыкты', 'жонот', 'жукт',
      'in transit', 'shipped', 'on the way', 'loading', 'sent',
      '在途', '已发', '运输', '装货', '发货',
    ],
  },
  {
    tone: DONE,
    starts: [
      'готов', 'доставл', 'прибыл', 'оплач', 'закрыт', 'принят', 'сдан',
      'даяр', 'жетти', 'толонду', 'бутту',
      'done', 'delivered', 'arrived', 'paid', 'closed', 'complete',
      '完成', '已到', '已付', '送达', '结清',
    ],
  },
  {
    tone: WAITING,
    starts: [
      'ожида', 'план', 'новый', 'заявк',
      'кутуудо', 'жаны',
      'waiting', 'pending', 'planned', 'new',
      '等待', '待处理', '计划', '新',
    ],
  },
  {
    tone: CANCELLED,
    starts: [
      'отмен', 'возврат', 'брак',
      'жокко', 'кайтар',
      'cancel', 'returned', 'refund', 'reject',
      '取消', '退货', '拒绝',
    ],
  },
]

/** Все статусы для списка вставки и для легенды. */
export const STATUS_TONES: StatusTone[] = [OVERDUE, TAX, PROGRESS, WAITING, DONE, CANCELLED]

/**
 * Приводит написанное к сравнимому виду: регистр, «ё», кыргызские буквы.
 *
 * «Мөөнөтү өттү» люди набирают и через ө, и через о — раскладка есть не
 * у всех. Сводим к одному написанию, иначе половина строк не покрасится.
 */
function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/ө/g, 'о')
    .replace(/ү/g, 'у')
    .replace(/ң/g, 'н')
}

function normalize(text: string): string {
  return fold(text.trim())
}

/**
 * Образцы приводятся к сравнимому виду один раз, при загрузке модуля.
 *
 * Раньше normalize вызывался на каждое из полутора сотен слов для каждой
 * ячейки, а таблица пересчитывает видимый участок на каждое нажатие клавиши:
 * сорок строк на сто столбцов обходились в 109 мс основного потока.
 *
 * Пробел в конце образца («до ») намеренно не срезается: без него «до»
 * совпадало с «Документы», «Доставка», «Договор» и «Долг».
 */
const FOLDED_RULES = RULES.map((rule) => ({
  tone: rule.tone,
  starts: rule.starts.map(fold),
}))

/**
 * Уточнения к разбору по началу слова.
 *
 * Начало слова — грубый признак, и на части оборотов он даёт обратный смысл:
 * «Долг погашен» — это не просрочка, а «Готово к отправке» — не доставка.
 * Список короткий и правится по месту: если в таблицах заведётся свой оборот,
 * добавить его сюда дешевле, чем перестраивать разбор.
 */
const OVERRIDES: { contains: string; tone: StatusTone | null }[] = [
  { contains: 'погашен', tone: DONE },
  { contains: 'пройден', tone: DONE },
  { contains: 'к отправке', tone: PROGRESS },
  { contains: 'к отгрузке', tone: PROGRESS },
  { contains: 'частично', tone: PROGRESS },
  { contains: 'к сведению', tone: null },
  { contains: 'возврат налог', tone: TAX },
  { contains: 'возврат пошлин', tone: TAX },
]

const FOLDED_OVERRIDES = OVERRIDES.map((item) => ({ ...item, contains: fold(item.contains) }))

export function statusTone(text: string | null): StatusTone | null {
  if (!text) return null

  const normalized = normalize(text)
  // Длинная фраза — это примечание, а не статус: красить её целиком незачем.
  if (!normalized || normalized.length > 40) return null

  for (const rule of FOLDED_RULES) {
    if (!rule.starts.some((start) => normalized.startsWith(start))) continue

    const override = FOLDED_OVERRIDES.find((item) => normalized.includes(item.contains))
    return override ? override.tone : rule.tone
  }
  return null
}

// ------------------------------- Сроки -------------------------------

/** Заголовки колонок, значения которых считаются сроком. */
const DEADLINE_HEADERS = [
  'прибыт', 'приезд', 'срок', 'дедлайн', 'до ', 'план', 'разгруз', 'подач', 'оплатить до',
  'жетуу', 'моонот',
  'arrival', 'deadline', 'due', 'eta', 'unload',
  '到达', '期限', '截止', '预计',
]

const FOLDED_DEADLINE_HEADERS = DEADLINE_HEADERS.map(fold)

/**
 * Заголовки, начинающиеся как срок, но сроком не являющиеся.
 *
 * «План» стоит в списке ради «Плановой даты», но под него попадает и
 * «Планируемая сумма» — а значения денежной колонки, прочитанные как даты,
 * красили бы строку без всякого повода.
 */
const NOT_DEADLINE = ['сумма', 'цена', 'стоимост', 'вес', 'количеств', 'объем', 'курс']
  .map(fold)

export function isDeadlineHeader(text: string | null): boolean {
  if (!text) return false
  const normalized = normalize(text)
  if (!FOLDED_DEADLINE_HEADERS.some((header) => normalized.startsWith(header))) return false
  return !NOT_DEADLINE.some((word) => normalized.includes(word))
}

/**
 * Разбор срока из ячейки.
 *
 * Понимает то, как пишут люди: «01.09.2026 18:00», «01.09.2026», «18:00»,
 * «2026-09-01 18:00». Одно время без даты — это сегодня: в журнале рейсов
 * так и пишут, когда машина выходит и приходит в один день.
 */
export function parseDeadline(text: string | null, now: Date = new Date()): Date | null {
  if (!text) return null

  const value = text.trim()
  if (!value || value.length > 24) return null

  // Только двоеточие: точка в «12.05» — это день и месяц, а не часы. Раньше
  // такая запись в колонке со сроком читалась как 12:05 сегодня, и ячейка
  // краснела в тот же день.
  const onlyTime = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (onlyTime) {
    const hours = Number(onlyTime[1])
    const minutes = Number(onlyTime[2])
    if (hours > 23 || minutes > 59) return null
    const date = new Date(now)
    date.setHours(hours, minutes, 0, 0)
    return Number.isNaN(date.getTime()) ? null : date
  }

  const parts = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})(?:[ ,]+(\d{1,2})[:.](\d{2}))?$/.exec(value)
  if (parts) {
    const year = Number(parts[3].length === 2 ? `20${parts[3]}` : parts[3])
    return build(year, Number(parts[2]), Number(parts[1]),
                 Number(parts[4] ?? 23), Number(parts[5] ?? 59))
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?$/.exec(value)
  if (iso) {
    return build(Number(iso[1]), Number(iso[2]), Number(iso[3]),
                 Number(iso[4] ?? 23), Number(iso[5] ?? 59))
  }

  return null
}

/**
 * Собирает дату и проверяет, что она существует.
 *
 * Date сам переносит лишнее на следующий месяц: «31.02.2026» превращалось
 * в 3 марта, и ячейка получала срок, которого никто не назначал.
 */
function build(year: number, month: number, day: number,
               hours: number, minutes: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  if (hours > 23 || minutes > 59) return null

  const date = new Date(year, month - 1, day, hours, minutes, 0, 0)
  if (Number.isNaN(date.getTime())) return null
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

/** За сколько до срока ячейка становится жёлтой. */
const SOON_MS = 2 * 60 * 60 * 1000

/**
 * Цвет по сроку.
 *
 * `settled` — строка уже закрыта («Готово», «Прибыл», «Отменён»). Такую
 * не красим: груз доехал, и красный рядом с «Готово» только сбивал бы с толку.
 */
export function deadlineTone(deadline: Date, now: Date, settled: boolean): StatusTone | null {
  if (settled) return null

  const left = deadline.getTime() - now.getTime()
  if (left < 0) return OVERDUE
  if (left < SOON_MS) return SOON
  return null
}

/** Строка закрыта: где-то в ней стоит «Готово», «Прибыл» или «Отменён». */
export function isSettled(values: (string | null)[]): boolean {
  return values.some((value) => {
    const tone = statusTone(value)
    return tone?.kind === 'done' || tone?.kind === 'cancelled'
  })
}
