import { chromium, devices } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices['iPhone 13'], locale:'ru-RU' })
const page = await ctx.newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.waitForTimeout(1500)
try {
  await page.getByRole('button', { name:'Создать таблицу' }).click({ timeout: 10000 })
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 25000 })
  console.log('тап сработал, открыт редактор')
  await page.waitForTimeout(3500)
  const tb = await page.evaluate(() => {
    const n = document.querySelector('[role="toolbar"]')
    return n ? { высота: Math.round(n.getBoundingClientRect().height), прокручивается: n.scrollWidth > n.clientWidth } : 'панели нет'
  })
  console.log('панель:', JSON.stringify(tb))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  console.log('ширина сверх экрана:', overflow)
  await page.screenshot({ path:'qa/shots/probe25-editor-mobile.png' })
} catch (e) {
  console.log('не получилось:', e.message.split('\n')[0])
  await page.screenshot({ path:'qa/shots/probe25-fail.png' })
}
await b.close()
