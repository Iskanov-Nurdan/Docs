/**
 * Удаление машин (строк журнала) и прочих записей, подсветка поиска.
 * Только локальный docker (:8080). Всё созданное — убирает за собой.
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const OTHER = { email: 'qa-other@test.local', password: 'QaOther12345!' }
const ADMIN = { email: 'qa-admin@test.local', password: 'QaAdmin12345!' }
const SHOTS = 'shots/delete'
mkdirSync(SHOTS, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let failed = 0
let n = 0
async function check(page, name, fn) {
  n += 1
  try {
    const v = (await fn()) ?? {}
    if (v.bug) { failed += 1; await page.screenshot({ path: `${SHOTS}/${n}-bug.png` }) }
    console.log(`${v.bug ? 'BUG ' : 'ok  '} ${name}${v.detail ? ` — ${v.detail}` : ''}`)
  } catch (e) {
    failed += 1
    console.log(`ERR  ${name} — ${String(e.message).split('\n')[0].slice(0, 200)}`)
    await page.screenshot({ path: `${SHOTS}/${n}-err.png` }).catch(() => {})
  }
  for (let i = 0; i < 3; i += 1) {
    if ((await page.locator('[role="dialog"], [role="menu"]').count().catch(() => 0)) === 0) break
    await page.keyboard.press('Escape').catch(() => {}); await sleep(200)
  }
}
async function login(page, who) {
  await page.goto(`${BASE}/login`, { timeout: 90000 })
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 30000 })
}
const api = async (page, method, path, data) => {
  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data })
  return { status: r.status(), body: await r.json().catch(() => null) }
}
const grid = (page) => page.locator('[role="grid"]')
const at = (col, row) => ({ x: col * 100 + 30, y: row * 24 + 12 })
async function type(page, col, row, text) {
  await grid(page).click({ position: at(col, row) }); await sleep(150)
  await grid(page).dblclick({ position: at(col, row) })
  await page.keyboard.type(text); await page.keyboard.press('Enter'); await sleep(150)
}
const columnA = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter((c) => c.style.left === '0px' && c.offsetHeight > 0).sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top))
  .map((c) => c.textContent.trim()).filter(Boolean))
const PLATES = ['01KG111AAA', '01KG222BBB', '01KG333CCC', '01KG444DDD', '01KG555EEE', '01KG666FFF']

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' })
const page = await ctx.newPage()
await login(page, USER)
const { body: doc } = await api(page, 'POST', '/documents/', { title: 'DELCHECK журнал' })
await page.goto(`${BASE}/documents/${doc.id}`)
await grid(page).waitFor({ timeout: 30000 }); await sleep(1200)
await type(page, 0, 0, 'Машина'); await type(page, 1, 0, 'Груз')
for (const [i, plate] of PLATES.entries()) {
  await type(page, 0, i + 1, plate); await type(page, 1, i + 1, i % 2 ? 'Мука' : 'Сахар')
}

await check(page, 'Правая кнопка → «Удалить строку» → Отмена: машина на месте', async () => {
  await grid(page).click({ position: at(0, 2), button: 'right' })
  const menu = page.getByRole('menu', { name: 'Действия со строкой' })
  await menu.getByRole('menuitem', { name: 'Удалить строку' }).click()
  const dialog = page.getByRole('dialog')
  const text = await dialog.innerText()
  await dialog.getByRole('button', { name: 'Отмена' }).click(); await sleep(300)
  const left = await columnA(page)
  return { bug: !text.includes('01KG222BBB') || !left.includes('01KG222BBB'), detail: text.replace(/\s+/g, ' ').slice(0, 120) }
})

await check(page, 'Подтверждение удаляет именно выбранную машину', async () => {
  await grid(page).click({ position: at(1, 2), button: 'right' })
  await page.getByRole('menuitem', { name: 'Удалить строку' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click(); await sleep(500)
  const left = await columnA(page)
  const ok = !left.includes('01KG222BBB') && ['01KG111AAA', '01KG333CCC'].every((p) => left.includes(p))
  return { bug: !ok, detail: left.join(' ') }
})

await check(page, 'Удаление сохраняется после перезагрузки', async () => {
  await sleep(1500); await page.reload(); await grid(page).waitFor(); await sleep(1500)
  const left = await columnA(page)
  return { bug: left.includes('01KG222BBB') || !left.includes('01KG333CCC'), detail: left.join(' ') }
})

await check(page, 'Несколько строк кнопкой на панели, Ctrl+Z возвращает все', async () => {
  await grid(page).click({ position: at(0, 2) })
  await grid(page).click({ position: at(0, 3), modifiers: ['Shift'] }); await sleep(200)
  await page.getByTitle('Удалить строку').click()
  const dialog = page.getByRole('dialog')
  const text = (await dialog.innerText()).replace(/\s+/g, ' ')
  await dialog.getByRole('button', { name: 'Удалить', exact: true }).click(); await sleep(500)
  const after = await columnA(page)
  await grid(page).click({ position: at(5, 10) })
  await page.keyboard.press('Control+z'); await sleep(500)
  const back = await columnA(page)
  const ok = text.includes('01KG333CCC') && text.includes('01KG444DDD')
    && !after.includes('01KG333CCC') && !after.includes('01KG444DDD') && after.includes('01KG555EEE')
    && back.includes('01KG333CCC') && back.includes('01KG444DDD')
  return { bug: !ok, detail: `окно: «${text.slice(0, 90)}»; после: ${after.length}, после Ctrl+Z: ${back.length}` }
})

await check(page, 'Скрытые фильтром строки внутри выделения не удаляются', async () => {
  await page.getByLabel('Действия со столбцом B').click()
  await page.getByRole('menuitem', { name: /Фильтр/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Мука').uncheck()
  await dialog.getByRole('button', { name: 'Применить', exact: true }).click(); await sleep(600)
  const visible = await columnA(page)
  // Видны: шапка, 111AAA, 333CCC, 555EEE (Сахар). Выделяем от 111 до 555.
  await grid(page).click({ position: at(0, 1) })
  await grid(page).click({ position: at(0, 3), modifiers: ['Shift'] }); await sleep(200)
  await page.getByTitle('Удалить строку').click()
  const text = (await page.getByRole('dialog').innerText()).replace(/\s+/g, ' ')
  await page.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click(); await sleep(500)
  await page.getByLabel('Действия со столбцом B').click()
  await page.getByRole('menuitem', { name: 'Снять фильтр' }).click(); await sleep(500)
  const all = await columnA(page)
  const kept = ['01KG444DDD', '01KG666FFF'].every((p) => all.includes(p))
  const gone = ['01KG111AAA', '01KG333CCC', '01KG555EEE'].every((p) => !all.includes(p))
  return { bug: !kept || !gone || text.includes('DDD'), detail: `видно до: ${visible.join(' ')}; окно: «${text.slice(0, 80)}»; итог: ${all.join(' ')}` }
})

// Поиск: целиком желтеет одна строка
for (const [i, plate] of ['AA1', 'AA2', 'AA3'].entries()) { await type(page, 0, i + 5, plate); await type(page, 1, i + 5, 'Ташкент') }
await check(page, 'Поиск по листу: целиком подсвечена только текущая строка', async () => {
  await grid(page).click({ position: at(3, 1) })
  await page.keyboard.press('Control+f')
  await page.getByLabel('Только по номеру машины (на всех листах)').uncheck()
  await page.getByLabel('Что искать').fill('Ташкент'); await sleep(600)
  const rows = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
    const pale = new Set(cells.filter((c) => c.className.includes('bg-amber-100')).map((c) => c.style.top))
    const strong = cells.filter((c) => c.className.includes('bg-amber-200')).length
    return { pale: pale.size, strong }
  })
  await page.getByLabel('Закрыть поиск').click(); await sleep(300)
  const leftover = await page.evaluate(() => document.querySelectorAll('[role="gridcell"][class*="bg-amber"]').length)
  return { bug: rows.pale !== 1 || rows.strong !== 3 || leftover > 0, detail: `строк целиком: ${rows.pale}, ячеек-совпадений: ${rows.strong}, после закрытия: ${leftover}` }
})

await check(page, 'Escape отменяет правку ячейки', async () => {
  await grid(page).dblclick({ position: at(0, 5) })
  await page.keyboard.type('ЛИШНЕЕ'); await page.keyboard.press('Escape'); await sleep(300)
  const left = await columnA(page)
  return { bug: !left.includes('AA1'), detail: left.join(' ') }
})

// Режим «Просмотр»: пункты меню недоступны
await check(page, 'В режиме «Просмотр» удаление недоступно', async () => {
  await page.getByLabel('Режим работы').click()
  await page.getByRole('option', { name: /Просмотр/ }).click(); await sleep(400)
  await grid(page).click({ position: at(0, 5), button: 'right' })
  const disabled = await page.getByRole('menuitem', { name: 'Удалить строку' }).isDisabled()
  await page.keyboard.press('Escape')
  const toolbar = await page.getByTitle('Удалить строку').isDisabled()
  await page.getByLabel('Режим работы').click()
  await page.getByRole('option', { name: /Редактирование/ }).click(); await sleep(300)
  return { bug: !disabled || !toolbar, detail: `меню отключено: ${disabled}, кнопка отключена: ${toolbar}` }
})

// Справочник точек: удаление, ошибка сервера, объяснение для не-админа
const adminCtx = await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: 'ru-RU' })
const admin = await adminCtx.newPage()
await login(admin, ADMIN)
await check(admin, 'Точка: ошибка сервера показывается, окно не закрывается', async () => {
  const created = await api(admin, 'POST', '/places/', { name: 'DELCHECK точка' })
  await admin.goto(`${BASE}/routes`); await sleep(1500)
  await admin.route(`**/api/places/${created.body.id}/`, (route) => route.request().method() === 'DELETE'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Сервер недоступен"}' })
    : route.continue())
  await admin.getByLabel('Удалить точку DELCHECK точка').click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click(); await sleep(800)
  const stillOpen = await admin.getByRole('dialog').count()
  const alert = await admin.getByRole('dialog').getByRole('alert').innerText().catch(() => '')
  await admin.keyboard.press('Escape'); await admin.unroute(`**/api/places/${created.body.id}/`)
  const exists = (await api(admin, 'GET', '/places/')).body
  const list = Array.isArray(exists) ? exists : exists?.results ?? []
  return { bug: !stillOpen || !alert || !list.some((p) => p.id === created.body.id), detail: `окно открыто: ${Boolean(stillOpen)}, текст: «${alert}»` }
})
await check(admin, 'Точка удаляется, список обновляется без перезагрузки', async () => {
  await admin.getByLabel('Удалить точку DELCHECK точка').click()
  await admin.getByRole('dialog').getByRole('button', { name: 'Удалить', exact: true }).click(); await sleep(1000)
  const shown = await admin.getByText('DELCHECK точка').count()
  const body = (await api(admin, 'GET', '/places/')).body
  const inDb = (Array.isArray(body) ? body : body?.results ?? []).some((p) => p.name === 'DELCHECK точка')
  return { bug: shown > 0 || inDb, detail: `на экране: ${shown}, в базе: ${inDb}` }
})
await adminCtx.close()
await check(page, 'Не-админу на «Точках и маршрутах» объяснено, кто удаляет', async () => {
  await page.goto(`${BASE}/routes`); await sleep(1500)
  const note = await page.getByText('Добавлять и удалять точки и маршруты может администратор').count()
  const trash = await page.getByLabel(/^Удалить точку/).count()
  return { bug: note === 0 || trash > 0, detail: `пояснение: ${note}, кнопок удаления: ${trash}` }
})

await api(page, 'DELETE', `/documents/${doc.id}/`)
console.log(failed ? `\nПроблем: ${failed}` : '\nВсё прошло')
await browser.close()
