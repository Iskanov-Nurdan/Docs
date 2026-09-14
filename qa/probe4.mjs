import { chromium } from 'playwright'
const BASE = 'http://localhost:8080'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'qa@test.local')
await page.fill('input[type="password"]', 'QaTest12345!')
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
await page.getByRole('button', { name: 'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/)
await page.waitForTimeout(2000)

const cells = async () => page.evaluate(() =>
  Array.from(document.querySelectorAll('[role="gridcell"]'))
    .filter((n) => n.textContent.trim()).map((n) => `${n.style.left}/${n.style.top}=${n.textContent.trim()}`))

// Латиница одиночным кликом.
await page.locator('[role="grid"]').click({ position: { x: 60, y: 20 } })
await page.keyboard.type('Latin')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
console.log('латиница, клик+набор ->', JSON.stringify(await cells()))

// Кириллица посимвольно через press.
await page.locator('[role="grid"]').click({ position: { x: 160, y: 20 } })
for (const ch of 'Кир') await page.keyboard.press(ch)
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
console.log('кириллица через press->', JSON.stringify(await cells()))

// Проверяем, доходит ли keydown до приложения.
const seen = await page.evaluate(() => new Promise((resolve) => {
  const grid = document.querySelector('[role="grid"]')
  const events = []
  const handler = (e) => events.push({ key: e.key, type: e.type })
  grid.addEventListener('keydown', handler)
  window.__done = () => { grid.removeEventListener('keydown', handler); resolve(events) }
  setTimeout(() => window.__done(), 3000)
}))
await page.locator('[role="grid"]').click({ position: { x: 260, y: 20 } })
await page.keyboard.type('Яя')
console.log('события keydown при кириллице:', JSON.stringify(seen))
await browser.close()
