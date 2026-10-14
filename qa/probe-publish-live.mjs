/** Публикация через интерфейс сразу после правки: правка должна попасть на страницу. */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const api = async (page, method, path, data) => {
  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data })
  return { status: r.status(), body: await r.json().catch(() => null) }
}

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' })).newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', USER.email)
await page.fill('input[type="password"]', USER.password)
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
const { body: doc } = await api(page, 'POST', '/documents/', { title: 'PROBE publish live' })
try {
  await page.goto(`${BASE}/documents/${doc.id}`)
  const grid = page.locator('[role="grid"]')
  await grid.waitFor(); await sleep(1200)
  await grid.click({ position: { x: 230, y: 36 } })
  await page.keyboard.type('FRESHUI'); await page.keyboard.press('Enter'); await sleep(500)
  await page.getByRole('button', { name: /Поделиться/ }).click()
  await page.getByRole('button', { name: 'Опубликовать' }).click()
  await sleep(1200)
  const pub = await api(page, 'GET', `/documents/${doc.id}/publish/`)
  const shown = await api(page, 'GET', `/published/${pub.body.public_id}/`)
  const ok = JSON.stringify(shown.body).includes('FRESHUI')
  console.log(`${ok ? 'ok  ' : 'BUG '} Публикация из интерфейса сразу после правки — ${ok ? 'правка на странице' : JSON.stringify(shown.body?.content).slice(0, 120)}`)
} finally {
  await api(page, 'DELETE', `/documents/${doc.id}/publish/`)
  await api(page, 'DELETE', `/documents/${doc.id}/?permanent=true`)
  await api(page, 'DELETE', `/documents/${doc.id}/`)
  await api(page, 'DELETE', `/documents/${doc.id}/?permanent=true`)
  await browser.close()
}
