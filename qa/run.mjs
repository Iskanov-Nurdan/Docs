/**
 * Сквозная проверка приложения глазами пользователя.
 *
 * Каждый шаг проверяет не «кнопка нажалась», а что получилось: появилась ли
 * запись в списке, изменилось ли значение в ячейке, исчезла ли строка, что
 * ответил сервер. После шага интерфейс возвращается в исходное состояние —
 * иначе одно незакрытое окно роняет всё, что идёт следом.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const OTHER = { email: 'qa-other@test.local', password: 'QaOther12345!' }
const ADMIN = { email: 'qa-admin@test.local', password: 'QaAdmin12345!' }

const here = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SHOTS = `${here}shots`
mkdirSync(SHOTS, { recursive: true })

const results = []
const consoleErrors = []
const networkErrors = []
let current = 'старт'

const log = (...args) => console.log(...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Закрывает всё, что могло остаться открытым: окна, меню, панель поиска. */
async function calmDown(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('[role="dialog"]').count()) === 0) break
    await page.keyboard.press('Escape')
    await sleep(200)
  }
  const stuck = await page.locator('[role="dialog"]').count()
  if (stuck > 0) {
    const close = page.getByRole('button', { name: 'Закрыть' })
    if (await close.count() > 0) await close.first().click({ timeout: 2000 }).catch(() => {})
  }
  // Меню закрываем только клавишей: щелчок «мимо» в левом верхнем углу
  // попадал по кнопке возврата к списку, и следующий шаг начинался уже
  // на другой странице.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('[role="menu"], [role="listbox"]').count()) === 0) break
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(250)
  }
}

async function step(page, name, fn) {
  current = name
  const started = Date.now()
  try {
    await fn()
    results.push({ name, status: 'PASS', ms: Date.now() - started })
    log(`  PASS  ${name}`)
  } catch (error) {
    const file = `${SHOTS}/${String(results.length).padStart(2, '0')}-${name.replace(/[^\w]+/g, '-').slice(0, 32)}.png`
    await page.screenshot({ path: file }).catch(() => {})
    results.push({ name, status: 'FAIL', error: String(error.message || error).split('\n')[0], shot: file })
    log(`  FAIL  ${name}\n        ${String(error.message || error).split('\n')[0]}`)
  }
  await calmDown(page)
}

async function waitFor(check, { timeout = 10000, message = 'условие не выполнилось' } = {}) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    try {
      if (await check()) return true
    } catch (error) {
      last = error
    }
    await sleep(200)
  }
  throw new Error(`${message}${last ? ` (${String(last.message).split('\n')[0]})` : ''}`)
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 20000 })
}

/**
 * Убирает следы прошлых прогонов.
 *
 * Одинаковые названия мешают проверкам: «документ пропал из списка» нельзя
 * подтвердить, когда таких документов там три. Папки чистим тоже — иначе
 * боковая панель обрастает десятком «Папка QA».
 */
async function wipeAll(page) {
  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const headers = { Authorization: `Bearer ${token}` }

  const documents = async (scope) => {
    const response = await page.request.get(`${BASE}/api/documents/?scope=${scope}&page_size=100`, { headers })
    const body = await response.json().catch(() => null)
    return body?.results || []
  }

  // Сначала в корзину, затем из неё: удаление навсегда доступно владельцу
  // и для активного документа, но так надёжнее и ближе к жизни.
  for (const item of await documents('active')) {
    await page.request.delete(`${BASE}/api/documents/${item.id}/`, { headers })
  }
  for (const item of await documents('trash')) {
    await page.request.delete(`${BASE}/api/documents/${item.id}/?permanent=true`, { headers })
  }

  const folders = await page.request.get(`${BASE}/api/folders/`, { headers })
  for (const folder of (await folders.json().catch(() => [])) || []) {
    await page.request.delete(`${BASE}/api/folders/${folder.id}/`, { headers })
  }

  const templates = await page.request.get(`${BASE}/api/templates/?blocks=false`, { headers })
  for (const item of (await templates.json().catch(() => [])) || []) {
    if (item.is_personal) await page.request.delete(`${BASE}/api/templates/${item.id}/`, { headers })
  }
}

/** Запрос к API от имени открытой вкладки — чтобы сверять с тем, что на экране. */
async function api(page, path) {
  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const response = await page.request.get(`${BASE}/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return { status: response.status(), body: await response.json().catch(() => null) }
}

/**
 * Ввод в ячейку двойным щелчком.
 *
 * Не «кликнуть и печатать»: playwright отправляет кириллицу как вставку
 * текста, без нажатий клавиш, и такой ввод не открывает правку — как и
 * экранная клавиатура телефона. Двойной щелчок открывает ячейку явно, и
 * дальше текст печатается в поле. Латиницу и цифры проверяем отдельно —
 * тем самым путём «встал и печатаю».
 */
async function typeInCell(page, x, y, text) {
  await page.locator('[role="grid"]').dblclick({ position: { x, y } })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
}

const main = async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ru-RU' })
  const page = await context.newPage()

  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (text.includes('React Router Future Flag')) return
    consoleErrors.push({ step: current, text: text.slice(0, 400) })
  })
  page.on('pageerror', (error) => consoleErrors.push({ step: current, text: `pageerror: ${error.message}` }))
  page.on('response', (response) => {
    const url = response.url()
    if (!url.includes('/api/')) return
    if (response.status() < 400) return
    // Ожидаемые отказы проверяемых сценариев считаем нормой.
    const expected = current.includes('Неверный пароль') || current.includes('чужой')
    networkErrors.push({ step: current, url, status: response.status(), expected })
  })

  let docUrl = ''

  log('\n=== ВХОД И ПРАВА ===')

  await step(page, 'Неавторизованного не пускает внутрь', async () => {
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/login/, { timeout: 10000 })
  })

  await step(page, 'Неверный пароль: ошибка, внутрь не пускает', async () => {
    await page.fill('input[type="email"]', USER.email)
    await page.fill('input[type="password"]', 'не-тот-пароль')
    await page.click('button[type="submit"]')
    await waitFor(async () => (await page.locator('[role="alert"], .text-red-600').count()) > 0,
      { message: 'сообщение об ошибке не показано' })
    assert(page.url().includes('/login'), 'с неверным паролем пустило внутрь')
  })

  await step(page, 'Вход с верным паролем', async () => {
    await login(page, USER)
    await waitFor(async () => (await page.getByRole('heading', { name: 'Мои документы' }).count()) > 0,
      { message: 'после входа нет заголовка «Мои документы»' })
    await wipeAll(page)
    await page.reload({ waitUntil: 'domcontentloaded' })
  })

  log('\n=== ДОКУМЕНТ: СОЗДАНИЕ, ПРАВКА, СОХРАНЕНИЕ ===')

  await step(page, 'Создание таблицы открывает редактор', async () => {
    await page.getByRole('button', { name: 'Создать таблицу' }).click()
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 20000 })
    docUrl = page.url()
    await waitFor(async () => (await page.locator('[role="grid"]').count()) > 0,
      { message: 'сетка не отрисовалась' })
  })

  await step(page, 'Переименование дошло до сервера', async () => {
    const title = page.getByLabel('Название документа')
    await title.fill('Проверка QA')
    await title.blur()
    await waitFor(async () => {
      const { body } = await api(page, '/documents/?scope=active')
      return (body?.results || []).some((item) => item.title === 'Проверка QA')
    }, { message: 'название не сохранилось на сервере' })
  })

  await step(page, 'Ввод в ячейки виден в таблице', async () => {
    await typeInCell(page, 60, 20, 'Машина')
    await typeInCell(page, 60, 44, '01KG777AAA')
    await waitFor(async () => (await page.getByText('01KG777AAA', { exact: true }).count()) > 0,
      { message: 'введённое значение не появилось' })
  })

  await step(page, 'Набор по выделенной ячейке открывает правку', async () => {
    // Путь без двойного щелчка: встал на ячейку и печатаешь.
    await page.locator('[role="grid"]').click({ position: { x: 360, y: 20 } })
    await page.keyboard.type('AUTO-1')
    await page.keyboard.press('Enter')
    await waitFor(async () => (await page.getByText('AUTO-1', { exact: true }).count()) > 0,
      { message: 'набор по выделенной ячейке не записался' })
  })

  await step(page, 'Формула считается', async () => {
    await typeInCell(page, 160, 20, 'Сумма')
    await typeInCell(page, 160, 44, '10')
    await typeInCell(page, 160, 68, '20')
    await typeInCell(page, 160, 92, '30')
    await typeInCell(page, 160, 116, '=СУММ(B2:B4)')
    await waitFor(async () => (await page.getByText('60', { exact: true }).count()) > 0,
      { message: 'сумма 60 не появилась' })
  })

  await step(page, 'Формула с ссылкой на себя даёт понятную ошибку', async () => {
    await typeInCell(page, 460, 20, '=СУММ(E1:E3)')
    await waitFor(async () => (await page.getByText('#ЦИКЛ!', { exact: true }).count()) > 0,
      { message: 'кольцевая ссылка не поймана' })
    // Убираем, чтобы не мешала дальнейшим проверкам.
    await page.locator('[role="grid"]').click({ position: { x: 460, y: 20 } })
    await page.keyboard.press('Delete')
  })

  await step(page, 'Статус красится по смыслу слова', async () => {
    await typeInCell(page, 260, 20, 'Статус')
    await typeInCell(page, 260, 44, 'Просрочка')
    await waitFor(async () => {
      const painted = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
        const cell = cells.find((node) => node.textContent.trim() === 'Просрочка')
        if (!cell) return null
        return getComputedStyle(cell).backgroundColor
      })
      return painted && painted !== 'rgba(0, 0, 0, 0)' && painted !== 'transparent'
    }, { message: 'ячейка «Просрочка» не покрасилась' })
  })

  await step(page, 'Правка сохраняется на сервере (снимок книги)', async () => {
    const id = docUrl.split('/').pop()
    // Снимок уходит, когда человек покидает страницу.
    await page.getByLabel('К списку таблиц').click()
    await page.waitForURL(/\/documents$/, { timeout: 10000 })

    await waitFor(async () => {
      const { body } = await api(page, `/documents/${id}/`)
      const cells = body?.content?.sheets?.[0]?.cells || {}
      return Object.values(cells).some((cell) => cell.value === '01KG777AAA')
    }, { timeout: 20000, message: 'книга не сохранилась на сервере' })

    await page.goto(docUrl, { waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.getByText('01KG777AAA', { exact: true }).count()) > 0,
      { timeout: 20000, message: 'после перезагрузки данные не показаны' })
  })

  log('\n=== ИНСТРУМЕНТЫ ТАБЛИЦЫ ===')

  await step(page, 'Поиск по таблице находит значение', async () => {
    await page.locator('[role="grid"]').click({ position: { x: 60, y: 20 } })
    await page.keyboard.press('Control+f')
    const field = page.getByPlaceholder('Номер, артикул или часть текста')
    await waitFor(async () => (await field.count()) > 0, { message: 'панель поиска не открылась' })
    await field.fill('01KG777')
    await waitFor(async () => /\b1\s*(из|\/)\s*1\b/i.test(await page.locator('body').innerText()),
      { message: 'поиск не показал «1 из 1»' })
  })

  await step(page, 'Закрепление шапки включается и выключается', async () => {
    await page.getByTitle('Закрепить шапку').click()
    await waitFor(async () => (await page.getByTitle('Открепить шапку').count()) > 0,
      { message: 'кнопка не переключилась' })
    await page.getByTitle('Открепить шапку').click()
    await waitFor(async () => (await page.getByTitle('Закрепить шапку').count()) > 0,
      { message: 'кнопка не вернулась в исходное' })
  })

  await step(page, 'Сортировка столбца меняет порядок строк', async () => {
    // В столбце B стоят 10, 20, 30 — сортируем по убыванию.
    await page.getByLabel('Действия со столбцом B').click()
    await page.getByRole('menuitem', { name: 'Сортировать по убыванию' }).click()
    await waitFor(async () => {
      const order = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
        return cells.map((node) => node.textContent.trim())
      })
      const first = order.indexOf('30')
      const second = order.indexOf('10')
      return first !== -1 && second !== -1 && first < second
    }, { message: 'порядок строк не изменился' })
  })

  await step(page, 'Фильтр скрывает строки, снятие возвращает', async () => {
    const shown = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
      .map((node) => node.textContent.trim()))

    await page.getByLabel('Действия со столбцом B').click()
    await page.getByRole('menuitem', { name: 'Фильтр…' }).click()
    const dialog = page.getByRole('dialog')
    await waitFor(async () => (await dialog.count()) > 0, { message: 'окно фильтра не открылось' })

    await dialog.getByRole('button', { name: 'Снять все' }).click()
    // Оставляем только «20»: значения 10 и 30 должны исчезнуть из таблицы.
    const boxes = dialog.locator('label')
    const keep = boxes.filter({ hasText: /^20$/ }).first()
    await keep.locator('input[type="checkbox"]').check()
    await dialog.getByRole('button', { name: 'Применить' }).click()

    await waitFor(async () => {
      const values = await shown()
      return values.includes('20') && !values.includes('30') && !values.includes('10')
    }, { message: 'фильтр не скрыл лишние строки' })

    await page.getByLabel('Действия со столбцом B').click()
    await page.getByRole('menuitem', { name: 'Снять фильтр' }).click()
    await waitFor(async () => {
      const values = await shown()
      return values.includes('30') && values.includes('10')
    }, { message: 'после снятия фильтра строки не вернулись' })
  })

  await step(page, 'Фильтр по промежутку отбирает по числам', async () => {
    const shown = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
      .map((node) => node.textContent.trim()))

    await page.getByLabel('Действия со столбцом B').click()
    await page.getByRole('menuitem', { name: /^Фильтр/ }).click()
    const dialog = page.getByRole('dialog')
    await waitFor(async () => (await dialog.count()) > 0, { message: 'окно фильтра не открылось' })

    await dialog.getByRole('button', { name: 'Промежуток' }).click()
    await dialog.getByLabel('От').fill('15')
    await dialog.getByRole('button', { name: 'Применить' }).click()

    // В столбце 10, 20, 30 — остаться должны только два последних.
    await waitFor(async () => {
      const values = await shown()
      return values.includes('20') && values.includes('30') && !values.includes('10')
    }, { message: 'промежуток «от 15» не отобрал строки' })

    await page.getByLabel('Действия со столбцом B').click()
    await page.getByRole('menuitem', { name: 'Снять фильтр' }).click()
    await waitFor(async () => (await shown()).includes('10'),
      { message: 'после снятия промежутка строки не вернулись' })
  })

  await step(page, 'Список значений: в ячейке появляется выбор', async () => {
    await page.getByLabel('Действия со столбцом D').click()
    await page.getByRole('menuitem', { name: /Список значений/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('textarea').fill(['В пути', 'Прибыл'].join(String.fromCharCode(10)))
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await waitFor(async () => (await dialog.count()) === 0, { message: 'окно не закрылось' })

    // Открываем ячейку D2 — под ней должен появиться список значений.
    await page.locator('[role="grid"]').dblclick({ position: { x: 360, y: 44 } })
    const choice = page.locator('button', { hasText: /^Прибыл$/ }).last()
    await waitFor(async () => (await choice.count()) > 0, { message: 'список значений не показан' })
    await choice.click()
    await waitFor(async () => {
      const values = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
        .map((node) => node.textContent.trim()))
      return values.includes('Прибыл')
    }, { message: 'выбранное значение не записалось в ячейку' })
  })

  await step(page, 'Правило подсветки красит ячейку', async () => {
    await page.getByLabel('Действия со столбцом B').click()
    await page.getByRole('menuitem', { name: /Правило подсветки/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input').first().fill('15')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await waitFor(async () => {
      const painted = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
        const cell = cells.find((node) => node.textContent.trim() === '30')
        return cell ? getComputedStyle(cell).backgroundColor : null
      })
      return painted && painted !== 'rgba(0, 0, 0, 0)'
    }, { message: 'ячейка со значением 30 не покрасилась правилом «больше 15»' })
  })

  await step(page, 'Диаграмма строится по столбцам', async () => {
    await page.getByTitle('Диаграммы').click()
    const dialog = page.getByRole('dialog')
    await waitFor(async () => (await dialog.count()) > 0, { message: 'окно диаграмм не открылось' })
    const build = dialog.getByRole('button', { name: 'Построить диаграмму' })
    if (await build.count() > 0) await build.click()
    // Столбец чисел — второй (B): там 10/20/30.
    await dialog.getByLabel('Столбец чисел').click()
    await page.getByRole('option', { name: /Сумма/ }).first().click()
    await waitFor(async () => (await dialog.locator('svg[role="img"]').count()) > 0,
      { message: 'диаграмма не нарисовалась' })
  })

  await step(page, 'Форма «Запись» добавляет строку', async () => {
    await page.getByTitle('Добавить запись формой').click()
    const dialog = page.getByRole('dialog')
    await waitFor(async () => (await dialog.count()) > 0, { message: 'форма не открылась' })
    await dialog.locator('input').first().fill('09KG999ZZZ')
    await dialog.getByRole('button', { name: /^Добавить/ }).click()
    await waitFor(async () => (await page.getByText('09KG999ZZZ', { exact: true }).count()) > 0,
      { message: 'запись не появилась в таблице' })
  })

  await step(page, 'Кнопка «Прибыл» отмечает приёмку', async () => {
    await page.locator('[role="grid"]').click({ position: { x: 60, y: 44 } })
    await page.getByTitle('Отметить прибытие машины в текущей строке').click()
    await waitFor(
      async () => /отмечено прибытие|Отмечать нечего|Принято \(/i.test(await page.locator('body').innerText()),
      { message: 'подтверждение приёмки не появилось' },
    )
  })

  await step(page, 'Меню «Файл»: выгрузка и шаблон на месте', async () => {
    await page.getByRole('button', { name: 'Файл' }).click()
    await waitFor(async () => (await page.getByRole('menuitem', { name: /Скачать Excel/ }).count()) > 0,
      { message: 'в меню «Файл» нет выгрузки в Excel' })
    assert(await page.getByRole('menuitem', { name: /Сохранить как шаблон/ }).count() > 0,
      'нет пункта «Сохранить как шаблон»')
  })

  await step(page, 'Сохранение своего шаблона', async () => {
    await page.getByRole('button', { name: 'Файл' }).click()
    await page.getByRole('menuitem', { name: /Сохранить как шаблон/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input').first().fill('Шаблон QA')
    await dialog.getByRole('button', { name: 'Сохранить' }).click()
    await waitFor(async () => {
      const { body } = await api(page, '/templates/?blocks=false')
      return Array.isArray(body) && body.some((item) => item.title === 'Шаблон QA' && item.is_personal)
    }, { message: 'личный шаблон не появился на сервере' })
  })

  log('\n=== СПИСОК, ПОИСК, КОРЗИНА ===')

  await step(page, 'Возврат к списку: таблица на месте', async () => {
    await page.getByLabel('К списку таблиц').click()
    await page.waitForURL(/\/documents$/, { timeout: 10000 })
    await waitFor(async () => (await page.getByText('Проверка QA').count()) > 0,
      { message: 'таблицы нет в списке' })
  })

  await step(page, 'Глобальный поиск находит по названию', async () => {
    await page.getByLabel('Поиск документов').fill('Проверка QA')
    await waitFor(async () => {
      const cards = await page.locator('li').filter({ hasText: 'Проверка QA' }).count()
      return cards > 0
    }, { message: 'поиск не нашёл таблицу' })
    await page.getByLabel('Поиск документов').fill('')
  })

  await step(page, 'Поиск по содержимому находит номер машины', async () => {
    await waitFor(async () => {
      const { body } = await api(page, '/documents/search/?q=01KG777')
      return Array.isArray(body) && body.some((item) => item.title === 'Проверка QA')
    }, { message: 'поиск по содержимому не нашёл таблицу' })
  })

  await step(page, 'Копия документа создаётся', async () => {
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    const card = page.locator('li').filter({ hasText: 'Проверка QA' }).first()
    await card.getByLabel(/Действия/).click()
    await page.getByRole('menuitem', { name: 'Создать копию' }).click()
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 20000 })
    await waitFor(async () => (await page.getByLabel('Название документа').inputValue()).startsWith('Копия'),
      { message: 'копия открылась с другим названием' })
  })

  await step(page, 'Удаление в корзину убирает из списка', async () => {
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    const card = page.locator('li').filter({ hasText: 'Копия Проверка QA' }).first()
    await card.getByLabel(/Действия/).click()
    await page.getByRole('menuitem', { name: 'В корзину' }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: 'Удалить' })
    await waitFor(async () => (await confirm.count()) > 0, { message: 'нет подтверждения удаления' })
    await confirm.click()
    await waitFor(async () => (await page.locator('li').filter({ hasText: 'Копия Проверка QA' }).count()) === 0,
      { message: 'документ остался в списке' })
  })

  await step(page, 'В корзине документ есть и восстанавливается', async () => {
    await page.getByRole('link', { name: 'Корзина' }).click()
    await page.waitForURL(/\/trash/, { timeout: 10000 })
    await waitFor(async () => (await page.getByText('Копия Проверка QA').count()) > 0,
      { message: 'документа нет в корзине' })
    const card = page.locator('li').filter({ hasText: 'Копия Проверка QA' }).first()
    await card.getByLabel(/Действия/).click()
    await page.getByRole('menuitem', { name: 'Восстановить' }).click()
    await waitFor(async () => (await page.getByText('Копия Проверка QA').count()) === 0,
      { message: 'документ остался в корзине' })
  })

  await step(page, 'Избранное: добавление и раздел', async () => {
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    const card = page.locator('li').filter({ hasText: 'Проверка QA' }).first()
    await card.getByLabel('В избранное').first().click()
    await page.getByRole('link', { name: 'Избранное' }).click()
    await page.waitForURL(/\/starred/, { timeout: 10000 })
    await waitFor(async () => (await page.getByText('Проверка QA').count()) > 0,
      { message: 'документа нет в избранном' })
  })

  log('\n=== ПАПКИ И ШАБЛОНЫ ===')

  await step(page, 'Создание папки', async () => {
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Создать папку').click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('input').first().fill('Папка QA')
    await dialog.getByRole('button', { name: /Создать|Сохранить/ }).click()
    await waitFor(async () => (await page.getByRole('link', { name: 'Папка QA' }).count()) > 0,
      { message: 'папка не появилась в панели' })
  })

  await step(page, 'Пустое название папки не принимается', async () => {
    await page.getByLabel('Создать папку').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: /Создать|Сохранить/ }).click()
    await waitFor(async () => (await dialog.getByText(/Введите название/i).count()) > 0,
      { message: 'форма приняла пустое название' })
  })

  await step(page, 'Таблица из шаблона открывается заполненной', async () => {
    await page.getByRole('link', { name: 'Шаблоны' }).click()
    await page.waitForURL(/\/templates/, { timeout: 10000 })
    await waitFor(async () => (await page.getByText('Груз из Китая').count()) > 0,
      { message: 'шаблонов нет в галерее' })
    await page.getByText('Груз из Китая').first().click()
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 25000 })
    await waitFor(async () => (await page.getByText('Поставщик', { exact: true }).count()) > 0,
      { message: 'таблица из шаблона пустая' })
  })

  await step(page, 'Свой шаблон виден в галерее и удаляется', async () => {
    await page.goto(`${BASE}/templates`, { waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.getByText('Шаблон QA').count()) > 0,
      { message: 'своего шаблона нет в галерее' })
    await page.getByLabel(/Удалить шаблон/).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Удалить' }).click()
    await waitFor(async () => (await page.getByText('Шаблон QA').count()) === 0,
      { message: 'шаблон остался в галерее' })
  })

  log('\n=== ПРАВА ДОСТУПА ===')

  await step(page, 'Чужой документ недоступен', async () => {
    const id = docUrl.split('/').pop()
    const context2 = await browser.newContext({ locale: 'ru-RU' })
    const other = await context2.newPage()
    await login(other, OTHER)
    const { status } = await api(other, `/documents/${id}/`)
    assert(status === 404 || status === 403, `чужой документ отдался с кодом ${status}`)
    await context2.close()
  })

  await step(page, 'Обычному пользователю админка недоступна', async () => {
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
    const { status } = await api(page, '/admin/summary/')
    assert(status === 403 || status === 401, `админское API ответило ${status} обычному пользователю`)
  })

  await step(page, 'Настройки открываются и профиль виден', async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.getByRole('heading', { name: /Настройки|Профиль/ }).count()) > 0,
      { message: 'страница настроек пуста' })
  })

  await step(page, 'Выход из системы', async () => {
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    await page.getByLabel('Меню пользователя').click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await page.waitForURL(/\/login/, { timeout: 10000 })
  })

  await step(page, 'Админ видит статистику', async () => {
    await login(page, ADMIN)
    await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.getByText('Пользователей').count()) > 0,
      { message: 'админка не показала статистику' })
    const { status } = await api(page, '/admin/summary/')
    assert(status === 200, `админское API ответило ${status}`)
  })

  await page.screenshot({ path: `${SHOTS}/final.png` })

  const passed = results.filter((item) => item.status === 'PASS')
  const failed = results.filter((item) => item.status === 'FAIL')

  log(`\n===== ИТОГ: ${passed.length} PASS, ${failed.length} FAIL =====`)
  for (const item of failed) log(`FAIL ${item.name}\n     ${item.error}\n     ${item.shot}`)

  const realNetwork = networkErrors.filter((item) => !item.expected)
  log(`\nошибки консоли: ${consoleErrors.length}`)
  for (const item of consoleErrors.slice(0, 15)) log(`  [${item.step}] ${item.text.slice(0, 200)}`)
  log(`\nответы API 4xx/5xx (кроме ожидаемых): ${realNetwork.length}`)
  for (const item of realNetwork.slice(0, 15)) log(`  [${item.step}] ${item.status} ${item.url}`)

  writeFileSync(`${here}report.json`, JSON.stringify({ results, consoleErrors, networkErrors }, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error('ПРОГОН УПАЛ:', error)
  process.exit(1)
})
