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

await page.locator('[role="grid"]').click({ position: { x: 60, y: 20 } })
await page.keyboard.type('ABC-123')
await page.keyboard.press('Enter')
await page.waitForTimeout(500)

await page.locator('[role="grid"]').click({ position: { x: 60, y: 20 } })
await page.keyboard.press('Control+f')
await page.waitForTimeout(600)
await page.getByPlaceholder('Номер, артикул или часть текста').fill('ABC')
await page.waitForTimeout(800)
const panel = await page.evaluate(() => {
  const field = document.querySelector('input[placeholder="Номер, артикул или часть текста"]')
  const box = field?.closest('div')?.parentElement
  return box ? box.innerText.replace(/\n+/g, ' | ') : 'панель не найдена'
})
console.log('панель поиска:', panel)

// Меню столбца: закрывается ли по Escape.
await page.keyboard.press('Escape')
await page.getByLabel('Действия со столбцом A').click()
await page.waitForTimeout(400)
console.log('меню открыто:', await page.locator('[role="menu"]').count())
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
console.log('после Escape меню:', await page.locator('[role="menu"]').count())

// Форма записи: что за поля, когда шапка пустая.
await page.getByTitle('Добавить запись формой').click()
await page.waitForTimeout(600)
const dialogText = await page.locator('[role="dialog"]').innerText().catch(() => 'нет окна')
console.log('форма записи:', dialogText.replace(/\n+/g, ' | ').slice(0, 200))
await browser.close()
