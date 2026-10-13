/**
 * Охота на баги глазами пользователя: только находит, ничего не чинит.
 * Запуск: node bughunt.mjs (нужен локальный docker на :8080 и пользователи
 * qa@test.local, qa2@test.local).
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:8080'
const A = { email: 'qa@test.local', password: 'QaTest12345!' }
const B = { email: 'qa2@test.local', password: 'QaTest12345!' }
const here = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SHOTS = `${here}shots/bughunt`
mkdirSync(SHOTS, { recursive: true })

const results = []
const consoleErrors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const COL = 100
const ROW = 24

async function check(page, name, fn) {
  try {
    const verdict = await fn()
    const bug = verdict && verdict.bug
    results.push({ name, status: bug ? 'BUG' : 'ok', detail: verdict?.detail ?? '' })
    console.log(`${bug ? 'BUG ' : 'ok  '} ${name}${verdict?.detail ? ` — ${verdict.detail}` : ''}`)
    if (bug) await page.screenshot({ path: `${SHOTS}/${results.length}-${name.replace(/[^\wа-яё]+/gi, '-').slice(0, 40)}.png` })
  } catch (error) {
    results.push({ name, status: 'ERROR', detail: String(error.message).split('\n')[0] })
    console.log(`ERR  ${name} — ${String(error.message).split('\n')[0]}`)
    await page.screenshot({ path: `${SHOTS}/${results.length}-err.png` }).catch(() => {})
  }
  for (let i = 0; i < 3; i += 1) {
    if ((await page.locator('[role="dialog"], [role="menu"]').count()) === 0) break
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(200)
  }
}

async function waitFor(fn, timeout = 8000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await fn().catch(() => false)) return true
    await sleep(200)
  }
  return false
}

async function login(page, who) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 20000 })
}

async function token(page) {
  return page.evaluate(() => localStorage.getItem('docs.access'))
}

async function newDoc(page, title) {
  const response = await page.request.post(`${BASE}/api/documents/`, {
    headers: { Authorization: `Bearer ${await token(page)}` },
    data: { title },
  })
  const doc = await response.json()
  await page.goto(`${BASE}/documents/${doc.id}`)
  await page.locator('[role="grid"]').waitFor({ timeout: 20000 })
  await sleep(800)
  return doc.id
}

const grid = (page) => page.locator('[role="grid"]')

async function type(page, col, row, text, { enter = true } = {}) {
  // Сначала выделяем и ждём: полоса маршрута сдвигает сетку (отдельный баг,
  // проверяется в bughunt-shift.mjs), и двойной щелчок попадал бы мимо.
  await grid(page).click({ position: { x: col * COL + 30, y: row * ROW + 12 } })
  await sleep(350)
  await grid(page).dblclick({ position: { x: col * COL + 30, y: row * ROW + 12 } })
  await page.keyboard.type(text)
  if (enter) await page.keyboard.press('Enter')
  await sleep(150)
}

async function select(page, col, row) {
  await grid(page).click({ position: { x: col * COL + 30, y: row * ROW + 12 } })
  await sleep(350)
}

/** Текст ячейки по её положению в сетке. */
async function cell(page, col, row) {
  return page.evaluate(({ left, top }) => {
    const node = Array.from(document.querySelectorAll('[role="gridcell"]'))
      .find((item) => item.style.left === `${left}px` && item.style.top === `${top}px`)
    return node ? node.textContent.trim() : null
  }, { left: col * COL, top: row * ROW })
}

async function rowTexts(page, row, cols) {
  const out = []
  for (let col = 0; col < cols; col += 1) out.push(await cell(page, col, row))
  return out
}

const main = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' })
  const page = await ctx.newPage()
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('Future Flag')) consoleErrors.push(m.text().slice(0, 300))
  })
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e.message).slice(0, 300)))
  await login(page, A)

  // ---------------- Журнал: шапка и рейс ----------------
  const docId = await newDoc(page, 'BUGHUNT журнал')
  const H = ['Машина', 'Откуда', 'Через', 'Куда', 'Статус', 'Пройдено', 'Груз', 'Вес']
  for (let c = 0; c < H.length; c += 1) await type(page, c, 0, H[c])
  await type(page, 0, 1, '01KG777')

  await check(page, 'Список выбора: «ирк» + Enter в «Откуда» → Иркештам', async () => {
    await type(page, 1, 1, 'ирк')
    const got = await cell(page, 1, 1)
    return { bug: got !== 'Иркештам', detail: `в ячейке ${JSON.stringify(got)}` }
  })

  await check(page, 'Список выбора: «20» в «Вес» записывает 20', async () => {
    await type(page, 7, 1, '20')
    const got = await cell(page, 7, 1)
    return { bug: got !== '20', detail: `в ячейке ${JSON.stringify(got)}` }
  })

  await type(page, 2, 1, 'Каратай')
  // «Через» — галочки; набираем руками и закрываем Enter
  await type(page, 3, 1, 'Ташкент')
  await type(page, 4, 1, 'В пути')
  await type(page, 6, 1, 'Цемент')

  await check(page, '«Через» записался как набрали', async () => {
    const got = await cell(page, 2, 1)
    return { bug: got !== 'Каратай', detail: `в ячейке ${JSON.stringify(got)}` }
  })

  await check(page, 'Полоса маршрута появляется на строке рейса', async () => {
    await select(page, 0, 1)
    const ok = await waitFor(async () => (await page.getByRole('region', { name: /Маршрут/ }).count()) > 0, 4000)
    const text = ok ? await page.getByRole('region', { name: /Маршрут/ }).innerText() : ''
    return { bug: !ok, detail: text.replace(/\s+/g, ' ').slice(0, 160) }
  })

  await check(page, 'Кнопка на панели называет действие («Прошёл Каратай»)', async () => {
    await select(page, 0, 1)
    const label = await page.getByRole('button', { name: /Прош[её]л|Прибыл/ }).first().innerText()
    return { bug: !/Каратай/.test(label), detail: `кнопка: ${label}` }
  })

  // ---------------- Формулы ----------------
  await check(page, 'Формула =СУММ по «Вес» считает', async () => {
    await type(page, 7, 2, '30')
    await type(page, 7, 3, '=СУММ(H2:H3)')
    const got = await cell(page, 7, 3)
    return { bug: got !== '50', detail: `итог ${JSON.stringify(got)}` }
  })

  await check(page, 'Деление на ноль даёт понятную ошибку', async () => {
    await type(page, 9, 1, '=1/0')
    const got = await cell(page, 9, 1)
    return { bug: !/#/.test(got ?? ''), detail: `в ячейке ${JSON.stringify(got)}` }
  })

  await check(page, 'Ссылка на пустую ячейку в сумме не ломает', async () => {
    await type(page, 9, 2, '=J5+1')
    const got = await cell(page, 9, 2)
    return { bug: got !== '1', detail: `в ячейке ${JSON.stringify(got)}` }
  })

  await check(page, 'Текст «12/10» не превращается в дату/число', async () => {
    await type(page, 9, 3, '12/10')
    const got = await cell(page, 9, 3)
    return { bug: got !== '12/10', detail: `в ячейке ${JSON.stringify(got)}` }
  })

  await check(page, 'Номер «01KG777» не теряет ведущий ноль', async () => {
    const got = await cell(page, 0, 1)
    return { bug: got !== '01KG777', detail: `в ячейке ${JSON.stringify(got)}` }
  })

  await check(page, 'Число «007» (код) сохраняется как есть', async () => {
    await type(page, 9, 4, '007')
    const got = await cell(page, 9, 4)
    return { bug: got !== '007', detail: `в ячейке ${JSON.stringify(got)}` }
  })

  // ---------------- Отмена ----------------
  await check(page, 'Ctrl+Z отменяет последнюю правку', async () => {
    await type(page, 9, 5, 'отмени меня')
    await select(page, 0, 8)
    await page.keyboard.press('Control+z')
    await sleep(400)
    const got = await cell(page, 9, 5)
    return { bug: got !== '' && got !== null, detail: `после Ctrl+Z ${JSON.stringify(got)}` }
  })

  // ---------------- Поиск ----------------
  await check(page, 'Ctrl+F открывает поиск и находит «Цемент»', async () => {
    await select(page, 0, 8)
    await page.keyboard.press('Control+f')
    const opened = await waitFor(async () => (await page.getByLabel('Что искать').count()) > 0, 3000)
    if (!opened) return { bug: true, detail: 'панель не открылась' }
    // поиск по умолчанию только по машине — снимаем галочку
    const vehicle = page.getByLabel('Только по номеру машины')
    if (await vehicle.count()) await vehicle.uncheck()
    await page.getByLabel('Что искать').fill('цемент')
    await sleep(500)
    const status = await page.locator('[role="status"]').filter({ hasText: /из|Ничего/ }).first().innerText()
    await page.keyboard.press('Escape')
    return { bug: /Ничего/.test(status), detail: status }
  })

  // ---------------- Перегруз ----------------
  await check(page, 'Перегруз без колонки «Статус» не нужен — здесь она есть: перегружаем в Каратае', async () => {
    await select(page, 0, 1)
    await page.getByRole('button', { name: 'Перегруз' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 3000 })
    await dialog.getByLabel('Где перегрузили').fill('Каратай')
    await dialog.getByLabel('Новая машина').fill('02KG123')
    await dialog.getByRole('button', { name: 'Перегрузить' }).click()
    await sleep(600)
    const old = await rowTexts(page, 1, 9)
    const fresh = await rowTexts(page, 2, 9)
    const bad = old[4] !== 'Перегружен' || fresh[0] !== '02KG123' || fresh[1] !== 'Каратай'
    return { bug: bad, detail: `старая: ${old.join('|')} / новая: ${fresh.join('|')}` }
  })

  await check(page, 'После перегруза итог «Вес» не задвоился', async () => {
    // итог переехал на строку ниже
    const texts = []
    for (let r = 1; r <= 6; r += 1) texts.push(await cell(page, 7, r))
    const total = texts.find((t, i) => i > 0 && t && /^\d+$/.test(t) && Number(t) >= 50)
    return { bug: total !== '50', detail: `столбец «Вес»: ${texts.join('|')}` }
  })

  await check(page, 'На новой машине: «Прибыл» доводит до конца и переносит цепочку', async () => {
    await select(page, 0, 2)
    for (let i = 0; i < 4; i += 1) {
      const button = page.getByRole('button', { name: /^(Прибыл|Прош[её]л .*)$/ }).first()
      if (!(await button.isEnabled())) break
      await button.click()
      await sleep(500)
      if ((await page.getByRole('button', { name: 'Груз доставлен' }).count()) > 0) break
      await select(page, 0, 2)
    }
    const tab = await page.getByRole('button', { name: 'Груз доставлен' }).count()
      + await page.getByRole('tab', { name: 'Груз доставлен' }).count()
      + await page.getByText('Груз доставлен', { exact: true }).count()
    const left = await rowTexts(page, 1, 2)
    return { bug: tab === 0, detail: `лист «Груз доставлен»: ${tab > 0 ? 'есть' : 'нет'}; в журнале строка 2: ${left.join('|')}` }
  })

  // ---------------- Совместная правка ----------------
  await check(page, 'Второй пользователь видит правку первого в реальном времени', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: 'ru-RU' })
    const page2 = await ctx2.newPage()
    await login(page2, B)
    await page2.goto(`${BASE}/documents/${docId}`)
    await grid(page2).waitFor({ timeout: 20000 })
    await sleep(1500)
    await type(page, 10, 1, 'от первого')
    const seen = await waitFor(async () => (await cell(page2, 10, 1)) === 'от первого', 8000)
    await type(page2, 10, 2, 'от второго')
    const back = await waitFor(async () => (await cell(page, 10, 2)) === 'от второго', 8000)
    await ctx2.close()
    return { bug: !seen || !back, detail: `второй увидел: ${seen}, первый увидел ответ: ${back}` }
  })

  // ---------------- Форма «Запись» ----------------
  await check(page, 'Форма «Запись» добавляет строку', async () => {
    const id = await newDoc(page, 'BUGHUNT форма')
    for (const [c, h] of ['Машина', 'Груз', 'Статус'].entries()) await type(page, c, 0, h)
    await type(page, 0, 1, 'AAA-1')
    await page.getByRole('button', { name: 'Запись' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ timeout: 3000 })
    await dialog.getByLabel('Машина').fill('BBB-2')
    await dialog.getByLabel('Груз').fill('Мука')
    await dialog.getByRole('button', { name: 'Добавить' }).click()
    await sleep(600)
    const row2 = await rowTexts(page, 2, 3)
    void id
    return { bug: row2[0] !== 'BBB-2', detail: `строка 3: ${row2.join('|')}` }
  })

  // ---------------- Шаблон ----------------
  await check(page, 'Таблица из шаблона «Журнал рейсов» открывается с шапкой', async () => {
    const response = await page.request.get(`${BASE}/api/templates/`, { headers: { Authorization: `Bearer ${await token(page)}` } })
    const list = await response.json()
    const items = Array.isArray(list) ? list : list.results || []
    const tpl = items.find((t) => /Журнал рейсов/.test(t.title))
    if (!tpl) return { bug: true, detail: `шаблонов: ${items.map((t) => t.title).join(', ')}` }
    const created = await page.request.post(`${BASE}/api/documents/`, {
      headers: { Authorization: `Bearer ${await token(page)}` }, data: { title: 'BUGHUNT из шаблона', template_id: tpl.id },
    })
    const doc = await created.json().catch(() => ({}))
    if (!doc.id) return { bug: true, detail: `создание из шаблона → ${created.status()} ${JSON.stringify(doc).slice(0, 120)}` }
    await page.goto(`${BASE}/documents/${doc.id}`)
    await grid(page).waitFor({ timeout: 20000 })
    await sleep(1500)
    const head = await rowTexts(page, 0, 4)
    return { bug: !head[0], detail: `шапка: ${head.join('|')}` }
  })

  // ---------------- Страница «Скачать» ----------------
  await check(page, 'Раздел «Скачать» в меню открывает страницу с кнопкой', async () => {
    await page.goto(`${BASE}/documents`)
    await page.getByRole('link', { name: 'Скачать' }).first().click()
    await page.waitForURL(/\/download/)
    const ok = await waitFor(async () => (await page.getByText(/Скачать для|ещё не выложено|готовится/).count()) > 0, 5000)
    return { bug: !ok, detail: page.url() }
  })

  await check(page, 'Ошибки в консоли браузера за прогон', async () => ({
    bug: consoleErrors.length > 0,
    detail: consoleErrors.slice(0, 5).join(' || '),
  }))

  await browser.close()
  writeFileSync(`${here}bughunt-report.json`, JSON.stringify({ results, consoleErrors }, null, 1))
  console.log(`\nИТОГ: ${results.filter((r) => r.status === 'BUG').length} BUG, ${results.filter((r) => r.status === 'ERROR').length} ERROR, ${results.filter((r) => r.status === 'ok').length} ok`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
