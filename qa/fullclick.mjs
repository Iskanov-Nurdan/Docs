/**
 * Полный проход по сайту: нажимает каждую кнопку, которой нет в run.mjs и
 * bughunt*.mjs, и проверяет результат. Только локальный docker (:8080).
 *
 *   ok   — работает
 *   BUG  — не работает или работает не так
 *   ERR  — тест не смог дойти до проверки (сначала смотреть скриншот)
 */
import { chromium, devices } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const BASE = 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const ADMIN = { email: 'qa-admin@test.local', password: 'QaAdmin12345!' }
const SHOTS = 'shots/fullclick'
mkdirSync(SHOTS, { recursive: true })

const results = []
const consoleErrors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let section = ''

async function check(page, name, fn) {
  const label = `${section} · ${name}`
  try {
    const verdict = (await fn()) ?? {}
    const status = verdict.bug ? 'BUG' : 'ok'
    results.push({ name: label, status, detail: verdict.detail ?? '' })
    console.log(`${status === 'BUG' ? 'BUG ' : 'ok  '} ${label}${verdict.detail ? ` — ${verdict.detail}` : ''}`)
    if (verdict.bug) await page.screenshot({ path: `${SHOTS}/${results.length}-bug.png` })
  } catch (error) {
    const detail = String(error.message).split('\n')[0].slice(0, 200)
    results.push({ name: label, status: 'ERR', detail })
    console.log(`ERR  ${label} — ${detail}`)
    await page.screenshot({ path: `${SHOTS}/${results.length}-err.png` }).catch(() => {})
  }
  for (let i = 0; i < 3; i += 1) {
    if ((await page.locator('[role="dialog"], [role="menu"]').count().catch(() => 0)) === 0) break
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(200)
  }
}

async function waitFor(fn, timeout = 6000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await fn().catch(() => false)) return true
    await sleep(200)
  }
  return false
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { timeout: 90000 })
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 30000 })
}
const auth = async (page) => ({ Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('docs.access'))}` })
const api = async (page, method, path, data) => {
  const response = await page.request.fetch(`${BASE}/api${path}`, { method, headers: await auth(page), data })
  return { status: response.status(), body: await response.json().catch(() => null) }
}

const grid = (page) => page.locator('[role="grid"]')
async function select(page, col, row) {
  await grid(page).click({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await sleep(300)
}
async function type(page, col, row, text) {
  await select(page, col, row)
  await grid(page).dblclick({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await sleep(250)
}
async function cellNode(page, col, row) {
  return page.evaluateHandle(({ l, t }) => Array.from(document.querySelectorAll('[role="gridcell"]'))
    .find((n) => n.style.left === `${l}px` && n.style.top === `${t}px`) || null, { l: col * 100, t: row * 24 })
}
async function cell(page, col, row) {
  const node = await cellNode(page, col, row)
  return node.evaluate((n) => (n ? n.textContent.trim() : null))
}
async function cellStyle(page, col, row) {
  const node = await cellNode(page, col, row)
  return node.evaluate((n) => {
    if (!n) return null
    const s = getComputedStyle(n)
    return { weight: s.fontWeight, italic: s.fontStyle, underline: s.textDecorationLine, align: s.textAlign, color: s.color, bg: s.backgroundColor }
  })
}
async function newDoc(page, title) {
  const { body } = await api(page, 'POST', '/documents/', { title })
  await page.goto(`${BASE}/documents/${body.id}`)
  await grid(page).waitFor({ timeout: 30000 })
  await sleep(1000)
  return body.id
}
const tool = (page, title) => page.getByTitle(title, { exact: true }).first()

const main = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU', acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('console', (m) => { if (m.type() === 'error' && !/Future Flag|status of 40[0-9]/.test(m.text())) consoleErrors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e.message).slice(0, 200)))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await login(page, USER)

  // ============================ ТАБЛИЦА ============================
  section = 'Таблица'
  const docId = await newDoc(page, 'FULLCLICK таблица')
  for (const [c, h] of ['Машина', 'Кол-во', 'Статус', 'Заметка'].entries()) await type(page, c, 0, h)
  await type(page, 0, 1, 'AAA'); await type(page, 1, 1, '0,5'); await type(page, 0, 2, 'BBB'); await type(page, 1, 2, '2')

  await check(page, 'Полужирный / курсив / подчёркнутый', async () => {
    await select(page, 0, 1)
    await tool(page, 'Полужирный (Ctrl+B)').click()
    await tool(page, 'Курсив (Ctrl+I)').click()
    await tool(page, 'Подчёркнутый (Ctrl+U)').click()
    await sleep(300)
    const s = await cellStyle(page, 0, 1)
    return { bug: Number(s.weight) < 600 || s.italic !== 'italic' || !s.underline.includes('underline'), detail: JSON.stringify(s) }
  })
  await check(page, 'Повторное нажатие снимает полужирный', async () => {
    await select(page, 0, 1)
    await tool(page, 'Полужирный (Ctrl+B)').click()
    await sleep(300)
    const s = await cellStyle(page, 0, 1)
    return { bug: Number(s.weight) >= 600, detail: `weight ${s.weight}` }
  })
  await check(page, 'Выравнивание по центру и по правому краю', async () => {
    await select(page, 0, 1)
    await tool(page, 'По центру').click(); await sleep(250)
    const center = (await cellStyle(page, 0, 1)).align
    await tool(page, 'По правому краю').click(); await sleep(250)
    const right = (await cellStyle(page, 0, 1)).align
    return { bug: center !== 'center' || right !== 'right', detail: `${center} / ${right}` }
  })
  await check(page, 'Цвет текста и заливка', async () => {
    await select(page, 0, 2)
    await page.getByLabel('Цвет текста').fill('#ff0000')
    await page.getByLabel('Цвет заливки').fill('#00ff00')
    await sleep(400)
    const s = await cellStyle(page, 0, 2)
    return { bug: s.color !== 'rgb(255, 0, 0)' || s.bg !== 'rgb(0, 255, 0)', detail: `${s.color} / ${s.bg}` }
  })
  await check(page, 'Убрать оформление', async () => {
    await select(page, 0, 2)
    await tool(page, 'Убрать оформление').click(); await sleep(300)
    const s = await cellStyle(page, 0, 2)
    return { bug: s.color === 'rgb(255, 0, 0)' || s.bg === 'rgb(0, 255, 0)', detail: `${s.color} / ${s.bg}` }
  })
  await check(page, 'Формат «Процент» у 0,5 → 50%', async () => {
    await select(page, 1, 1)
    await page.getByLabel('Формат чисел').click()
    await page.getByRole('option', { name: /^Процент/ }).click()
    await sleep(300)
    const got = await cell(page, 1, 1)
    return { bug: got !== '50%', detail: got }
  })
  await check(page, 'Кнопка «Статус…» вписывает статус', async () => {
    await select(page, 2, 1)
    await page.getByRole('combobox', { name: 'Статус', exact: true }).click()
    await page.getByRole('option', { name: 'Готово' }).click()
    await sleep(300)
    const got = await cell(page, 2, 1)
    return { bug: got !== 'Готово', detail: got }
  })
  await check(page, 'Отменить / Повторить кнопками', async () => {
    await type(page, 3, 1, 'было')
    await tool(page, 'Отменить (Ctrl+Z)').click(); await sleep(300)
    const undone = await cell(page, 3, 1)
    await tool(page, 'Повторить (Ctrl+Y)').click(); await sleep(300)
    const redone = await cell(page, 3, 1)
    return { bug: undone !== '' || redone !== 'было', detail: `после отмены «${undone}», после повтора «${redone}»` }
  })
  await check(page, 'Вставить строку выше', async () => {
    await select(page, 0, 2)
    await tool(page, 'Вставить строку выше').click(); await sleep(400)
    const moved = await cell(page, 0, 3)
    const empty = await cell(page, 0, 2)
    return { bug: moved !== 'BBB' || empty !== '', detail: `строка 3: «${empty}», строка 4: «${moved}»` }
  })
  await check(page, 'Удалить строку', async () => {
    await select(page, 0, 2)
    await tool(page, 'Удалить строку').click(); await sleep(400)
    return { bug: (await cell(page, 0, 2)) !== 'BBB', detail: await cell(page, 0, 2) }
  })
  await check(page, 'Вставить столбец слева', async () => {
    await select(page, 1, 1)
    await tool(page, 'Вставить столбец слева').click(); await sleep(400)
    return { bug: (await cell(page, 2, 0)) !== 'Кол-во' || (await cell(page, 1, 0)) !== '', detail: `B1 «${await cell(page, 1, 0)}», C1 «${await cell(page, 2, 0)}»` }
  })
  await check(page, 'Удалить столбец', async () => {
    await select(page, 1, 1)
    await tool(page, 'Удалить столбец').click(); await sleep(400)
    return { bug: (await cell(page, 1, 0)) !== 'Кол-во', detail: await cell(page, 1, 0) }
  })

  // --- Листы ---
  await check(page, 'Добавить лист', async () => {
    const before = await page.getByRole('tablist', { name: 'Листы' }).getByRole('tab').count()
    await page.getByLabel('Добавить лист').first().click(); await sleep(500)
    const after = await page.getByRole('tablist', { name: 'Листы' }).getByRole('tab').count()
    return { bug: after !== before + 1, detail: `${before} → ${after}` }
  })
  await check(page, 'Переименовать лист двойным щелчком', async () => {
    const tabs = page.getByRole('tablist', { name: 'Листы' }).getByRole('tab')
    await tabs.last().dblclick()
    const input = page.getByLabel('Название листа')
    await input.fill('Второй лист')
    await input.press('Enter'); await sleep(400)
    return { bug: (await page.getByRole('tab', { name: 'Второй лист' }).count()) === 0, detail: await tabs.last().innerText() }
  })
  await check(page, 'Удалить лист', async () => {
    const tabs = page.getByRole('tablist', { name: 'Листы' }).getByRole('tab')
    const before = await tabs.count()
    await page.getByLabel('Удалить текущий лист').click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: /Удалить/ })
    if (await confirm.count()) await confirm.click()
    await sleep(500)
    return { bug: (await tabs.count()) !== before - 1, detail: `${before} → ${await tabs.count()}` }
  })
  await page.getByRole('tab').first().click(); await sleep(400)

  // --- Меню столбца ---
  await check(page, 'Список значений для столбца и выбор мышкой', async () => {
    await page.getByLabel('Действия со столбцом C').click()
    await page.getByRole('menuitem', { name: /Список значений/ }).click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('textarea').fill('Новый\nВ пути\nГотово')
    await dialog.getByRole('button', { name: /Сохранить|Готово|Применить/ }).first().click()
    await sleep(400)
    await select(page, 2, 2)
    await grid(page).dblclick({ position: { x: 230, y: 2 * 24 + 12 } })
    const option = page.getByRole('option', { name: 'В пути' })
    const shown = await waitFor(async () => (await option.count()) > 0, 3000)
    if (!shown) return { bug: true, detail: 'список не появился' }
    await option.click(); await sleep(300)
    return { bug: (await cell(page, 2, 2)) !== 'В пути', detail: await cell(page, 2, 2) }
  })
  await check(page, 'Фильтр по значению и снятие', async () => {
    await page.getByLabel('Действия со столбцом A').click()
    await page.getByRole('menuitem', { name: /Фильтр/ }).click()
    const dialog = page.getByRole('dialog')
    const box = dialog.getByLabel('BBB')
    if (await box.count()) await box.uncheck()
    await dialog.getByRole('button', { name: 'Применить', exact: true }).click()
    await sleep(600)
    const columnA = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
      .filter((n) => n.style.left === '0px' && n.textContent.trim()).map((n) => n.textContent.trim()))
    const hidden = !columnA.includes('BBB')
    await page.getByLabel('Действия со столбцом A').click()
    await page.getByRole('menuitem', { name: 'Снять фильтр' }).click(); await sleep(400)
    const back = await cell(page, 0, 2)
    return { bug: !hidden || back !== 'BBB', detail: `спряталась: ${hidden}, вернулась: «${back}»` }
  })
  await check(page, 'Диаграмма: столбики, линия, круг', async () => {
    await tool(page, 'Диаграммы').click()
    const dialog = page.getByRole('dialog')
    const build = dialog.getByRole('button', { name: 'Построить диаграмму' })
    if (await build.count()) await build.click()
    await dialog.getByLabel('Столбец подписей').click()
    await page.getByRole('option', { name: 'Машина' }).click()
    await dialog.getByLabel('Столбец чисел').click()
    await page.getByRole('option', { name: 'Кол-во' }).click()
    await sleep(300)
    const kinds = []
    for (const kind of ['Линия', 'Круг', 'Столбики']) {
      await dialog.getByLabel('Вид диаграммы').click()
      await page.getByRole('option', { name: kind }).click()
      await sleep(300)
      kinds.push(`${kind}:${await dialog.locator('svg[role="img"]').count()}`)
    }
    return { bug: kinds.some((k) => k.endsWith(':0')), detail: kinds.join(' ') }
  })

  // ============================ ЖУРНАЛ РЕЙСОВ ============================
  section = 'Журнал'
  const journalId = await newDoc(page, 'FULLCLICK журнал')
  for (const [c, h] of ['Дата', 'Машина', 'Откуда', 'Через', 'Куда', 'Вышел', 'Прибытие', 'Пройдено', 'Статус', 'Груз'].entries()) await type(page, c, 0, h)

  await check(page, '«Откуда» — выбор мышкой из списка', async () => {
    await select(page, 2, 1)
    await grid(page).dblclick({ position: { x: 230, y: 24 + 12 } })
    const option = page.getByRole('option', { name: 'Иркештам' })
    if (!(await waitFor(async () => (await option.count()) > 0, 3000))) return { bug: true, detail: 'список точек не появился' }
    await option.click(); await sleep(300)
    return { bug: (await cell(page, 2, 1)) !== 'Иркештам', detail: await cell(page, 2, 1) }
  })
  await check(page, '«Через» — несколько точек галочками', async () => {
    await select(page, 3, 1)
    await grid(page).dblclick({ position: { x: 330, y: 24 + 12 } })
    const box = page.getByText('Точки по пути — отметьте нужные')
    if (!(await waitFor(async () => (await box.count()) > 0, 3000))) return { bug: true, detail: 'галочки не появились' }
    const panel = box.locator('..')
    await panel.getByRole('button', { name: 'Каратай' }).click()
    await panel.getByRole('button', { name: 'Т', exact: true }).click()
    await panel.getByRole('button', { name: 'Готово' }).click()
    await sleep(300)
    const got = await cell(page, 3, 1)
    return { bug: got !== 'Каратай → Т', detail: got }
  })
  await check(page, '«Куда» — выбор мышкой', async () => {
    await select(page, 4, 1)
    await grid(page).dblclick({ position: { x: 430, y: 24 + 12 } })
    await page.keyboard.type('дост')
    const option = page.getByRole('option', { name: 'Достук' })
    if (!(await waitFor(async () => (await option.count()) > 0, 3000))) return { bug: true, detail: 'нет «Достук» в списке' }
    await option.click(); await sleep(600)
    return { bug: (await cell(page, 4, 1)) !== 'Достук', detail: await cell(page, 4, 1) }
  })
  await check(page, 'Срок прибытия посчитался сам после выбора «Куда»', async () => {
    const got = await cell(page, 6, 1)
    return { bug: !got, detail: got || 'пусто' }
  })
  await type(page, 1, 1, '01KG777'); await type(page, 8, 1, 'В пути')

  await check(page, 'Форма «Запись» с маршрутом и точкой по пути', async () => {
    await tool(page, 'Добавить запись формой').click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 3000 })
    await dialog.getByLabel('Машина').fill('02KG222')
    await dialog.getByLabel('Откуда').fill('Иркештам')
    await dialog.getByRole('button', { name: 'Точка по пути' }).click()
    await dialog.getByPlaceholder('Пункт').fill('Каратай')
    await dialog.getByLabel('Куда', { exact: true }).fill('Достук')
    const planned = await waitFor(async () => /посчитаем/.test(await dialog.innerText()), 3000)
    await dialog.getByRole('button', { name: 'Добавить' }).click()
    await sleep(700)
    const row = []
    for (let c = 0; c < 10; c += 1) row.push(await cell(page, c, 2))
    const ok = row[1] === '02KG222' && row[3] === 'Каратай' && row[4] === 'Достук' && Boolean(row[6])
    return { bug: !ok || !planned, detail: `расчёт в форме: ${planned}; строка: ${row.join('|')}` }
  })
  await check(page, 'Кнопка «Посчитать сроки» заполняет пустые', async () => {
    await type(page, 1, 3, '03KG333'); await type(page, 2, 3, 'Иркештам')
    await select(page, 4, 3); await grid(page).dblclick({ position: { x: 430, y: 3 * 24 + 12 } })
    await page.keyboard.type('Достук'); await page.keyboard.press('Enter'); await sleep(300)
    await type(page, 6, 3, 'x'); await select(page, 6, 3); await page.keyboard.press('Delete'); await sleep(300)
    await tool(page, 'Посчитать сроки прибытия по справочнику').click(); await sleep(600)
    const got = await cell(page, 6, 3)
    return { bug: !got, detail: got || 'пусто' }
  })
  await check(page, 'Загрузить Excel в таблицу кнопкой', async () => {
    const chooser = page.waitForEvent('filechooser')
    await tool(page, 'Загрузить из Excel или CSV (можно перетащить файл на таблицу)').click()
    await (await chooser).setFiles('../Журнал рейсов.xlsx')
    const ok = await waitFor(async () => (await page.getByRole('tab', { name: 'Груз доставлен' }).count()) > 0, 20000)
    return { bug: !ok, detail: ok ? 'листы из файла появились' : 'листы не появились' }
  })

  // ============================ ШАПКА ТАБЛИЦЫ ============================
  section = 'Шапка'
  await check(page, 'Файл → Скачать Excel', async () => {
    await page.getByRole('button', { name: 'Файл', exact: true }).click()
    const download = page.waitForEvent('download', { timeout: 30000 }).catch(() => null)
    const popup = page.waitForEvent('popup', { timeout: 30000 }).catch(() => null)
    await page.getByRole('menuitem', { name: /Excel/ }).click()
    const result = await Promise.race([download, popup])
    if (!result) return { bug: true, detail: 'файл не скачался' }
    const name = result.suggestedFilename ? result.suggestedFilename() : (await result.waitForEvent('download', { timeout: 10000 }).catch(() => null))?.suggestedFilename()
    return { bug: !name || !name.endsWith('.xlsx'), detail: name || 'открылось окно без файла' }
  })
  await check(page, 'Файл → Сохранить как шаблон', async () => {
    await page.getByRole('button', { name: 'Файл', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Сохранить как шаблон' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Название шаблона').fill('FULLCLICK шаблон')
    await dialog.getByRole('button', { name: /Сохранить/ }).click()
    await sleep(800)
    const { body } = await api(page, 'GET', '/templates/')
    const list = Array.isArray(body) ? body : body?.results || []
    const mine = list.find((t) => t.title === 'FULLCLICK шаблон')
    if (mine) await api(page, 'DELETE', `/templates/${mine.id}/`)
    return { bug: !mine, detail: mine ? 'шаблон создан и удалён' : 'шаблона нет' }
  })
  await check(page, 'История: сохранить версию, изменить, восстановить', async () => {
    await page.getByRole('tab').first().click(); await sleep(400)
    await type(page, 9, 5, 'до версии')
    await sleep(1500)
    await page.getByRole('button', { name: 'История' }).click()
    await page.getByRole('button', { name: 'Сохранить текущую' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Сохранить', exact: true }).click()
    await sleep(1200)
    await page.getByRole('button', { name: 'Закрыть' }).click(); await sleep(400)
    await type(page, 9, 5, 'после версии')
    await sleep(1500)
    await page.getByRole('button', { name: 'История' }).click()
    await page.getByLabel('Список версий').locator('button').first().click(); await sleep(800)
    await page.getByRole('button', { name: 'Восстановить эту версию' }).click()
    // Сама история — тоже диалог: подтверждение ищем в остальных.
    const confirm = page.getByRole('dialog').filter({ hasNot: page.getByLabel('Список версий') }).getByRole('button', { name: /Восстановить/ })
    if (await confirm.count()) await confirm.last().click()
    await sleep(2000)
    const close = page.getByRole('button', { name: 'Закрыть' })
    if (await close.count()) await close.first().click()
    await sleep(1500)
    const onScreen = await cell(page, 9, 5)
    await page.reload(); await grid(page).waitFor({ timeout: 30000 }); await sleep(2500)
    const afterReload = await cell(page, 9, 5)
    return {
      bug: onScreen !== 'до версии' || afterReload !== 'до версии',
      detail: `сразу после восстановления «${onScreen}», после F5 «${afterReload}»`,
    }
  })
  await check(page, 'Поделиться: приглашение по почте и отзыв', async () => {
    await page.getByRole('button', { name: 'Поделиться' }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки доступа' })
    await dialog.waitFor({ timeout: 4000 })
    await dialog.getByPlaceholder('name@example.com').fill('qa-admin@test.local')
    await dialog.getByRole('button', { name: /Пригласить|Добавить|Открыть доступ/ }).first().click()
    const added = await waitFor(async () => (await dialog.getByLabel(/Убрать доступ/).count()) > 0, 4000)
    if (added) await dialog.getByLabel(/Убрать доступ/).first().click()
    await sleep(400)
    const removed = (await dialog.getByLabel(/Убрать доступ/).count()) === 0
    return { bug: !added || !removed, detail: `добавлен: ${added}, убран: ${removed}` }
  })
  await check(page, 'Режим «Просмотр»: таблица не правится', async () => {
    await page.getByLabel('Режим работы').click()
    const view = page.getByRole('option', { name: /Просмотр|Чтение/ })
    if (!(await view.count())) return { bug: true, detail: 'нет режима просмотра в списке' }
    await view.first().click(); await sleep(400)
    await grid(page).dblclick({ position: { x: 930, y: 6 * 24 + 12 } })
    await page.keyboard.type('нельзя'); await page.keyboard.press('Enter'); await sleep(300)
    const got = await cell(page, 9, 6)
    await page.getByLabel('Режим работы').click()
    await page.getByRole('option', { name: /Редактирование/ }).first().click(); await sleep(300)
    return { bug: got === 'нельзя', detail: `в ячейке «${got}»` }
  })

  // ============================ ДОКУМЕНТЫ ============================
  section = 'Документы'
  await page.goto(`${BASE}/documents`); await sleep(1500)
  await check(page, 'Создать папку', async () => {
    await page.getByLabel('Создать папку').click()
    const dialog = page.getByRole('dialog')
    await dialog.getByPlaceholder('Например, Договоры').fill('FULLCLICK папка')
    await dialog.getByRole('button', { name: /Создать/ }).click(); await sleep(600)
    return { bug: (await page.getByText('FULLCLICK папка').count()) === 0 }
  })
  const card = () => page.getByText('FULLCLICK таблица', { exact: true }).first()
  const cardMenu = async (item) => {
    const row = page.locator('li, article, [role="row"]')
      .filter({ has: page.getByText('FULLCLICK таблица', { exact: true }) }).first()
    await row.hover()
    await row.getByRole('button', { name: /Действия|Ещё|Меню/ }).first().click()
    await page.getByRole('menuitem', { name: item }).click()
  }
  await check(page, 'Переименовать документ', async () => {
    await cardMenu('Переименовать')
    const input = page.getByRole('dialog').locator('input').first()
    await input.fill('FULLCLICK таблица 2'); await input.press('Enter'); await sleep(600)
    const ok = (await page.getByText('FULLCLICK таблица 2').count()) > 0
    await api(page, 'PATCH', `/documents/${docId}/`, { title: 'FULLCLICK таблица' }); await page.reload(); await sleep(1200)
    return { bug: !ok }
  })
  await check(page, 'Переместить в папку', async () => {
    await cardMenu('Переместить')
    const dialog = page.getByRole('dialog')
    await dialog.getByText('FULLCLICK папка').click()
    await dialog.getByRole('button', { name: /Переместить/ }).click(); await sleep(600)
    const { body } = await api(page, 'GET', `/documents/${docId}/`)
    return { bug: !body?.folder, detail: JSON.stringify(body?.folder)?.slice(0, 80) }
  })
  await page.goto(`${BASE}/documents`); await sleep(1200)
  await check(page, 'Создать копию', async () => {
    const before = (await api(page, 'GET', '/documents/?scope=active&page_size=100')).body?.count
    await page.goto(`${BASE}/folders/${(await api(page, 'GET', `/documents/${docId}/`)).body.folder?.id ?? ''}`); await sleep(1200)
    await cardMenu('Создать копию'); await sleep(800)
    const after = (await api(page, 'GET', '/documents/?scope=active&page_size=100')).body?.count
    return { bug: !(after > before), detail: `${before} → ${after}` }
  })
  await check(page, 'В корзину → восстановить', async () => {
    await page.goto(`${BASE}/folders/${(await api(page, 'GET', `/documents/${docId}/`)).body.folder?.id ?? ''}`); await sleep(1200)
    await cardMenu('В корзину')
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click(); await sleep(600)
    const trashed = (await api(page, 'GET', `/documents/${docId}/`)).body?.deleted_at
    await page.getByRole('link', { name: 'Корзина' }).first().click(); await sleep(1200)
    await cardMenu('Восстановить'); await sleep(600)
    const restored = !(await api(page, 'GET', `/documents/${docId}/`)).body?.deleted_at
    return { bug: !trashed || !restored, detail: `в корзине: ${Boolean(trashed)}, восстановлен: ${restored}` }
  })
  await check(page, 'Избранное', async () => {
    await page.goto(`${BASE}/documents`); await sleep(1200)
    const row = page.locator('li, article').filter({ hasText: 'FULLCLICK журнал' }).first()
    await row.hover()
    await row.getByRole('button', { name: /избранн/i }).first().click(); await sleep(500)
    await page.getByRole('link', { name: 'Избранное' }).first().click(); await sleep(1200)
    return { bug: (await page.getByText('FULLCLICK журнал').count()) === 0 }
  })
  await check(page, 'Сортировка и вид списком/сеткой', async () => {
    await page.goto(`${BASE}/documents`); await sleep(1200)
    await page.getByLabel('Списком').click(); await sleep(300)
    await page.getByLabel('Сеткой').click(); await sleep(300)
    await page.getByLabel('Сортировка').click()
    await page.getByRole('option', { name: 'По названию (А–Я)' }).click(); await sleep(600)
    return { bug: false }
  })
  await check(page, 'Поиск документов по содержимому', async () => {
    await page.getByLabel('Поиск документов').fill('Иркештам')
    await page.getByLabel('Поиск документов').press('Enter'); await sleep(1500)
    return { bug: (await page.getByText('FULLCLICK журнал').count()) === 0, detail: 'ищем слово из ячейки журнала' }
  })

  // ============================ НАСТРОЙКИ ============================
  section = 'Настройки'
  await page.goto(`${BASE}/settings`); await sleep(1200)
  await check(page, 'Тема: тёмная и обратно', async () => {
    await page.getByLabel('Тема').click()
    await page.getByRole('option', { name: 'Тёмная' }).click(); await sleep(500)
    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.theme === 'dark')
    await page.getByLabel('Тема').click()
    await page.getByRole('option', { name: 'Как в системе' }).click(); await sleep(300)
    return { bug: !dark, detail: `тёмная включилась: ${dark}` }
  })
  await check(page, 'Смена имени сохраняется', async () => {
    const name = page.getByLabel('Имя').first()
    const old = await name.inputValue()
    await name.fill('Тест-имя')
    await page.getByRole('button', { name: /Сохранить/ }).first().click(); await sleep(800)
    const me = (await api(page, 'GET', '/users/me/')).body
    await name.fill(old); await page.getByRole('button', { name: /Сохранить/ }).first().click(); await sleep(500)
    return { bug: me?.first_name !== 'Тест-имя', detail: me?.first_name }
  })
  await check(page, 'Смена пароля с неверным текущим даёт понятную ошибку', async () => {
    await page.getByLabel('Текущий пароль').fill('неверный')
    await page.getByLabel('Новый пароль').fill('NewPass12345!')
    await page.getByRole('button', { name: /Сменить пароль|Изменить пароль/ }).first().click(); await sleep(800)
    const text = await page.locator('[role="alert"]').allInnerTexts()
    return { bug: text.length === 0, detail: text.join(' | ').slice(0, 120) }
  })

  // ============================ ТЕЛЕФОН ============================
  section = 'Телефон'
  const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' })
  const mobile = await phone.newPage()
  await login(mobile, USER)
  await check(mobile, 'Меню разделов открывается и ведёт в «Скачать»', async () => {
    await mobile.getByLabel('Открыть меню').click()
    await mobile.getByRole('link', { name: 'Скачать' }).first().click()
    return { bug: !(await waitFor(async () => /\/download/.test(mobile.url()), 4000)) }
  })
  await check(mobile, 'Ввод в ячейку на телефоне', async () => {
    await mobile.goto(`${BASE}/documents/${journalId}`)
    await mobile.locator('[role="grid"]').waitFor({ timeout: 30000 }); await sleep(1500)
    await mobile.locator('[role="grid"]').dblclick({ position: { x: 930 % 360, y: 8 * 24 + 12 } })
    await mobile.keyboard.type('с телефона'); await mobile.keyboard.press('Enter'); await sleep(500)
    const found = await mobile.getByText('с телефона', { exact: true }).count()
    return { bug: found === 0 }
  })
  await phone.close()

  // ============================ АДМИНИСТРАТОР ============================
  section = 'Админ'
  const adminCtx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' })
  const admin = await adminCtx.newPage()
  await login(admin, ADMIN)
  await check(admin, 'Точки и маршруты: добавить точку, плечо, сумму и удалить', async () => {
    await admin.goto(`${BASE}/routes`); await sleep(1500)
    await admin.getByPlaceholder('Например, Кашгар').fill('QA-точка')
    await admin.getByPlaceholder('Например, Кашгар').press('Enter'); await sleep(600)
    const place = (await admin.getByText('QA-точка').count()) > 0
    await admin.getByPlaceholder('Например, 250').fill('777')
    await admin.getByPlaceholder('Например, 250').press('Enter'); await sleep(600)
    const amount = (await admin.getByText(/777/).count()) > 0
    const delAmount = admin.getByLabel(/Удалить сумму 777/)
    if (await delAmount.count()) { await delAmount.click(); const c = admin.getByRole('dialog').getByRole('button', { name: /Удалить/ }); if (await c.count()) await c.click() }
    const delPlace = admin.getByLabel('Удалить точку QA-точка')
    if (await delPlace.count()) { await delPlace.click(); const c = admin.getByRole('dialog').getByRole('button', { name: /Удалить/ }); if (await c.count()) await c.click() }
    await sleep(600)
    const cleaned = (await admin.getByText('QA-точка').count()) === 0
    return { bug: !place || !amount || !cleaned, detail: `точка: ${place}, сумма: ${amount}, убрано: ${cleaned}` }
  })
  await check(admin, 'Правка часов у плеча сохраняется', async () => {
    const input = admin.getByLabel('Часов: Иркештам — Каратай')
    const old = await input.inputValue()
    await input.fill('7.5'); await input.press('Tab'); await sleep(800)
    const { body } = await api(admin, 'GET', '/route-legs/')
    const legs = Array.isArray(body) ? body : body?.results || []
    const leg = legs.find((l) => l.origin_name === 'Иркештам' && l.destination_name === 'Каратай')
    await input.fill(old); await input.press('Tab'); await sleep(500)
    return { bug: Number(leg?.hours) !== 7.5, detail: `часов: ${leg?.hours}` }
  })
  await check(admin, 'Бухгалтерия открывается и показывает таблицы', async () => {
    await admin.goto(`${BASE}/accountant`); await sleep(2000)
    const text = await admin.locator('main').innerText().catch(() => '')
    return { bug: !/Грузов|Денег и грузов|таблиц/i.test(text), detail: text.replace(/\s+/g, ' ').slice(0, 120) }
  })
  await check(admin, 'Админка: поиск людей, новый пользователь, закрыть доступ', async () => {
    await admin.goto(`${BASE}/admin`); await sleep(1500)
    await admin.getByLabel('Поиск людей').fill('qa@'); await sleep(800)
    const found = (await admin.getByText('qa@test.local').count()) > 0
    await admin.getByLabel('Поиск людей').fill('')
    await admin.getByRole('button', { name: 'Завести пользователя' }).click()
    const dialog = admin.getByRole('dialog')
    await dialog.getByPlaceholder('name@example.com').fill('qa-fullclick@test.local')
    await dialog.getByLabel('Имя').fill('Проверка')
    const pwd = dialog.getByLabel('Пароль')
    if (await pwd.count()) await pwd.fill('QaFull12345!')
    await dialog.getByRole('button', { name: 'Завести', exact: true }).click(); await sleep(1000)
    const created = (await admin.getByText(/qa-fullclick@test\.local/).count()) > 0
    await admin.keyboard.press('Escape')
    return { bug: !found || !created, detail: `поиск: ${found}, создан: ${created}` }
  })

  await check(page, 'Ошибки в консоли за прогон', async () => ({ bug: consoleErrors.length > 0, detail: consoleErrors.slice(0, 4).join(' || ') }))

  writeFileSync('fullclick-report.json', JSON.stringify({ results, consoleErrors }, null, 1))
  const n = (s) => results.filter((r) => r.status === s).length
  console.log(`\nИТОГ: ${n('ok')} ok, ${n('BUG')} BUG, ${n('ERR')} ERR`)
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
