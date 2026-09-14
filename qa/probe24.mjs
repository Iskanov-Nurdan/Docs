import { chromium, devices } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const ctx = await b.newContext({ ...devices['iPhone 13'], locale:'ru-RU' })
const page = await ctx.newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.waitForTimeout(1500)
const diag = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Создать таблицу'))
  if (!btn) return 'кнопки нет'
  const r = btn.getBoundingClientRect()
  const top = document.elementFromPoint(Math.min(r.x + r.width/2, innerWidth-1), Math.min(r.y + r.height/2, innerHeight-1))
  return {
    прямоугольник: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    экран: [innerWidth, innerHeight],
    видима: r.y >= 0 && r.y < innerHeight && r.x >= 0,
    сверху: top === btn || btn.contains(top) ? 'сама кнопка' : `${top?.tagName}.${String(top?.className).slice(0,50)}`,
  }
})
console.log(JSON.stringify(diag, null, 1))
await page.screenshot({ path:'qa/shots/probe24-mobile.png' })
try {
  await page.getByRole('button', { name:'Создать таблицу' }).click({ timeout: 8000 })
  await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 20000 })
  console.log('тап по «Создать таблицу»: перешли в редактор')
  await page.waitForTimeout(3000)
  const tb = await page.evaluate(() => {
    const n = document.querySelector('[role="toolbar"]')
    return n ? { высота: Math.round(n.getBoundingClientRect().height), прокрутка: n.scrollWidth > n.clientWidth } : 'панели нет'
  })
  console.log('панель на телефоне:', JSON.stringify(tb))
  await page.screenshot({ path:'qa/shots/probe24-editor.png' })
} catch (e) {
  console.log('ошибка:', e.message.split('
')[0])
}
await b.close()
