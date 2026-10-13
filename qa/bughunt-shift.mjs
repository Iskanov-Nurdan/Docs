/** Проверка: прыгает ли сетка, когда появляется полоса маршрута. */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'qa@test.local')
await page.fill('input[type="password"]', 'QaTest12345!')
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
const token = await page.evaluate(() => localStorage.getItem('docs.access'))
const doc = await (await page.request.post(`${BASE}/api/documents/`, {
  headers: { Authorization: `Bearer ${token}` }, data: { title: 'BUGHUNT сдвиг' },
})).json()
await page.goto(`${BASE}/documents/${doc.id}`)
const grid = page.locator('[role="grid"]')
await grid.waitFor()
await sleep(800)

const type = async (col, row, text) => {
  await grid.dblclick({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await sleep(200)
}
for (const [c, h] of ['Машина', 'Откуда', 'Куда'].entries()) await type(c, 0, h)
await type(0, 1, 'A-1')
await type(1, 1, 'Иркештам')
await type(2, 1, 'Ташкент')

const top = async () => (await grid.boundingBox()).y
await grid.click({ position: { x: 30, y: 5 * 24 + 12 } })
await sleep(300)
const without = await top()
await grid.click({ position: { x: 30, y: 1 * 24 + 12 } })
await sleep(300)
const withStrip = await top()
console.log(`верх сетки: строка без рейса ${without}px, строка с рейсом ${withStrip}px, сдвиг ${withStrip - without}px`)

// Типичное действие человека: выделил рейс, затем дважды щёлкнул ячейку ниже, чтобы вписать.
await grid.click({ position: { x: 30, y: 1 * 24 + 12 } })
await sleep(300)
await grid.dblclick({ position: { x: 3 * 100 + 30, y: 4 * 24 + 12 } })
await page.keyboard.type('куда-то')
await page.keyboard.press('Enter')
await sleep(400)
const where = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter((n) => n.textContent.trim() === 'куда-то')
  .map((n) => `col ${parseInt(n.style.left) / 100}, row ${parseInt(n.style.top) / 24}`))
console.log('щёлкнули дважды по D5 (col 3, row 4), значение оказалось в:', where)
await page.screenshot({ path: 'shots/bughunt/shift.png' })
await page.request.delete(`${BASE}/api/documents/${doc.id}/`, { headers: { Authorization: `Bearer ${token}` } })
await browser.close()
