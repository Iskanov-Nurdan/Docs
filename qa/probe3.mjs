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
    .filter((n) => n.textContent.trim())
    .map((n) => `${n.style.left}/${n.style.top}=${n.textContent.trim()}`))

// 1. Быстрый набор (как у теста).
await page.locator('[role="grid"]').click({ position: { x: 60, y: 20 } })
await page.keyboard.type('Быстро')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
console.log('быстрый набор  ->', JSON.stringify(await cells()))

// 2. Медленный набор, как печатает человек.
await page.locator('[role="grid"]').click({ position: { x: 160, y: 20 } })
await page.keyboard.type('Медленно', { delay: 120 })
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
console.log('медленный набор->', JSON.stringify(await cells()))

// 3. Через двойной клик (открыть правку заранее).
await page.locator('[role="grid"]').dblclick({ position: { x: 260, y: 20 } })
await page.waitForTimeout(200)
await page.keyboard.type('ЧерезДваКлика')
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
console.log('двойной клик   ->', JSON.stringify(await cells()))
await browser.close()
