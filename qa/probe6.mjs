import { chromium } from 'playwright'
const BASE = 'http://localhost:8080'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('console', (m) => { if (m.type()==='error') console.log('CONSOLE:', m.text().slice(0,150)) })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'qa@test.local')
await page.fill('input[type="password"]', 'QaTest12345!')
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
await page.getByRole('button', { name: 'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/)
const url = page.url()
const id = url.split('/').pop()
await page.waitForTimeout(2500)

await page.locator('[role="grid"]').click({ position: { x: 60, y: 20 } })
await page.keyboard.type('SAVE-TEST')
await page.keyboard.press('Enter')
await page.waitForTimeout(1500)

const token = await page.evaluate(() => localStorage.getItem('docs.access'))
const check = async (label) => {
  const res = await page.request.get(`${BASE}/api/documents/${id}/`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await res.json()
  const cells = body.content?.sheets?.[0]?.cells || {}
  console.log(label, '| ячеек в базе:', Object.keys(cells).length, '|', JSON.stringify(Object.entries(cells).slice(0,3)))
}
await check('сразу после ввода')

// Уходим со страницы — это должно вызвать flush (снимок).
await page.getByLabel('К списку таблиц').click()
await page.waitForURL(/\/documents$/)
await page.waitForTimeout(2000)
await check('после ухода со страницы')

// Возвращаемся.
await page.goto(url)
await page.waitForTimeout(3000)
const visible = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .map(n => n.textContent.trim()).filter(Boolean))
console.log('видно после возврата:', JSON.stringify(visible))
await check('после возврата')
await page.screenshot({ path: 'qa/shots/probe6-after-return.png' })
await browser.close()
