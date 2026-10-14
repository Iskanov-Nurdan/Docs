/** Уточнение подозрений из fullclick2. Только локальный docker. */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const ADMIN = { email: 'qa-admin@test.local', password: 'QaAdmin12345!' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (bug, name, detail = '') => console.log(`${bug ? 'BUG ' : 'ok  '} ${name}${detail ? ` — ${detail}` : ''}`)

async function login(page, who) {
  await page.goto(`${BASE}/login`)
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
}
const api = async (page, method, path, data) => {
  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data })
  return { status: r.status(), body: await r.json().catch(() => null) }
}
const cells = (page) => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).map((n) => n.textContent.trim()).filter(Boolean))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' })
const page = await ctx.newPage()
await login(page, USER); await page.waitForURL(/\/documents/)
const { body: doc } = await api(page, 'POST', '/documents/', { title: 'FULLCLICK2B' })
await page.goto(`${BASE}/documents/${doc.id}`)
const grid = page.locator('[role="grid"]')
await grid.waitFor(); await sleep(1200)

// Набор латиницей и кириллицей «как с клавиатуры» (keydown с буквой)
await grid.click({ position: { x: 30, y: 36 } }); await sleep(200)
await page.keyboard.type('Sugar'); await page.keyboard.press('Enter'); await sleep(300)
await grid.click({ position: { x: 130, y: 36 } }); await sleep(200)
await page.keyboard.press('KeyA') // первая буква
for (const ch of 'ахар') await page.keyboard.insertText(ch)
await page.keyboard.press('Enter'); await sleep(300)
let now = await cells(page)
out(!now.includes('Sugar'), 'Набор на выделенной ячейке (латиница) начинает правку', now.join('|'))

// Escape
await grid.dblclick({ position: { x: 30, y: 36 } }); await sleep(200)
await page.keyboard.type('XXX'); await page.keyboard.press('Escape'); await sleep(500)
now = await cells(page)
out(now.includes('SugarXXX'), 'Escape отменяет правку', now.join('|'))

// Публикация сразу после правки
await grid.click({ position: { x: 230, y: 36 } }); await page.keyboard.type('FRESH'); await page.keyboard.press('Enter'); await sleep(800)
const pub = await api(page, 'POST', `/documents/${doc.id}/publish/`, { auto_update: false })
const shown = await api(page, 'GET', `/published/${pub.body.public_id}/`)
out(!JSON.stringify(shown.body).includes('FRESH'), 'Публикация сразу после правки показывает правку', JSON.stringify(shown.body?.content).slice(0, 100))
await api(page, 'DELETE', `/documents/${doc.id}/publish/`)

// Ссылка «у кого есть ссылка»: аноним → вход → вернуться в таблицу
await api(page, 'PUT', `/documents/${doc.id}/share-link/`, { access: 'anyone', role: 'viewer' })
const perms = await api(page, 'GET', `/documents/${doc.id}/permissions/`)
const token = perms.body?.link?.token
const anon = await browser.newContext({ locale: 'ru-RU' })
const guest = await anon.newPage()
await guest.goto(`${BASE}/documents/${doc.id}?link=${token}`); await sleep(1500)
const atLogin = guest.url().replace(BASE, '')
await login(guest, ADMIN); await sleep(4000)
const landed = guest.url().replace(BASE, '')
out(!landed.includes(doc.id), 'После входа по ссылке открывается та же таблица', `${atLogin} → ${landed}`)
await anon.close()

// Закрыть/вернуть доступ обычным админом
const adminCtx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' })
const admin = await adminCtx.newPage()
await login(admin, ADMIN); await admin.waitForURL(/\/documents/)
const created = await api(admin, 'POST', '/admin/users/', { email: 'qa-fc2@test.local', first_name: 'Проверка', password: 'QaFc2Pass123!' })
await admin.goto(`${BASE}/admin`); await sleep(1500)
await admin.getByLabel('Поиск людей').fill('qa-fc2'); await sleep(1000)
await admin.getByRole('button', { name: 'Закрыть доступ' }).first().click(); await sleep(300)
await admin.getByRole('dialog').getByRole('button', { name: 'Закрыть доступ' }).click(); await sleep(1000)
const bctx = await browser.newContext(); const b = await bctx.newPage()
await login(b, { email: 'qa-fc2@test.local', password: 'QaFc2Pass123!' }); await sleep(2500)
const blockedText = (await b.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160)
out(!/\/login/.test(b.url()), 'Закрытый не может войти', blockedText)
await admin.getByRole('button', { name: 'Вернуть доступ' }).first().click(); await sleep(1000)
const b2 = await bctx.newPage()
await login(b2, { email: 'qa-fc2@test.local', password: 'QaFc2Pass123!' })
const back = await b2.waitForURL(/\/documents/, { timeout: 10000 }).then(() => true).catch(() => false)
out(!back, 'После «Вернуть доступ» снова входит', `создан: ${created.status}`)
await bctx.close(); await adminCtx.close()

await api(page, 'DELETE', `/documents/${doc.id}/`)
await browser.close()
