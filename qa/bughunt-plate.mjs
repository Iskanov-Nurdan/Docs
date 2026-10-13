/** Поиск по номеру машины в настоящем журнале: номер лежит на «Груз доставлен». */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'

const BASE = 'http://localhost:8080'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const browser = await chromium.launch()
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage()
await page.goto(`${BASE}/login`, { timeout: 90000 })
await page.fill('input[type="email"]', 'qa@test.local')
await page.fill('input[type="password"]', 'QaTest12345!')
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('docs.access'))}` }

const file = readFileSync('../Журнал рейсов.xlsx')
const response = await page.request.post(`${BASE}/api/documents/import/`, {
  headers,
  multipart: { file: { name: 'BUGHUNT журнал.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: file } },
})
const doc = await response.json()
await page.goto(`${BASE}/documents/${doc.id}`)
await page.locator('[role="grid"]').waitFor({ timeout: 30000 })
await sleep(2000)

for (const query of ['AJ8722', 'аj8722', 'AJ 8722', 'RS6215']) {
  await page.locator('[role="grid"]').click({ position: { x: 30, y: 60 } })
  await sleep(300)
  await page.keyboard.press('Control+f')
  const field = page.getByLabel('Что искать')
  await field.waitFor({ timeout: 5000 })
  await field.fill(query)
  await sleep(800)
  const status = await page.locator('[role="status"]').filter({ hasText: /из|Ничего/ }).first().innerText().catch(() => '—')
  const activeTab = await page.locator('[aria-current="page"], [aria-selected="true"]').filter({ hasText: /В пути|Груз доставлен/ }).first().innerText().catch(() => '?')
  console.log(`${/Ничего|—/.test(status) ? 'BUG ' : 'ok  '} «${query}» → ${status} | открыт лист: ${activeTab}`)
  await page.keyboard.press('Escape')
  await sleep(300)
}
await page.screenshot({ path: 'shots/bughunt/plate.png' })
await page.request.delete(`${BASE}/api/documents/${doc.id}/`, { headers })
await browser.close()
