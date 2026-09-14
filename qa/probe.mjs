// Разведка: смотрим, как устроены места, где упали тесты.
import { chromium } from 'playwright'
const BASE = 'http://localhost:8080'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'qa@test.local')
await page.fill('input[type="password"]', 'QaTest12345!')
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)

// Кнопки и ссылки боковой панели и шапки.
const labels = await page.evaluate(() => {
  const out = { links: [], buttons: [] }
  document.querySelectorAll('a').forEach((a) => out.links.push(a.textContent.trim().slice(0, 30)))
  document.querySelectorAll('button').forEach((b) =>
    out.buttons.push((b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent).trim().slice(0, 40)))
  return out
})
console.log('ССЫЛКИ:', JSON.stringify(labels.links.filter(Boolean)))
console.log('КНОПКИ:', JSON.stringify(labels.buttons.filter(Boolean)))

// Открываем документ и смотрим панель редактора.
await page.getByRole('button', { name: /Создать таблицу/i }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/)
await page.waitForTimeout(2500)
const editor = await page.evaluate(() => {
  const out = []
  document.querySelectorAll('button').forEach((b) =>
    out.push((b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent).trim().slice(0, 40)))
  return out.filter(Boolean)
})
console.log('ПАНЕЛЬ РЕДАКТОРА:', JSON.stringify(editor))

// Ctrl+F: открывается ли панель поиска и какое у поля место.
await page.locator('[role="grid"]').click({ position: { x: 60, y: 20 } })
await page.keyboard.press('Control+f')
await page.waitForTimeout(700)
const findInputs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('input')).map((i) => i.placeholder || i.getAttribute('aria-label')).filter(Boolean))
console.log('ПОЛЯ ПОСЛЕ Ctrl+F:', JSON.stringify(findInputs))

await page.screenshot({ path: 'qa/shots/probe-editor.png' })
await browser.close()
