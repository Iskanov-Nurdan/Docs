import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)
const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(160,20,'Summa'); await type(160,44,'10'); await type(160,68,'20'); await type(160,92,'30')

await page.getByLabel('Действия со столбцом B').click()
await page.waitForTimeout(400)
console.log('меню:', await page.locator('[role="menuitem"]').count())
try {
  await page.getByRole('menuitem', { name: 'Фильтр…' }).click({ timeout: 5000 })
  console.log('клик по «Фильтр…» прошёл')
} catch (e) {
  console.log('клик не прошёл:', e.message.split('\n')[0])
  const dbg = await page.evaluate(() => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(n => n.textContent.includes('Фильтр'))
    const r = item.getBoundingClientRect()
    return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
             visible: r.width > 0 && r.height > 0,
             style: getComputedStyle(item).pointerEvents,
             parentStyle: getComputedStyle(item.parentElement).visibility }
  })
  console.log('состояние пункта:', JSON.stringify(dbg))
}
await page.waitForTimeout(500)
console.log('окно фильтра открылось:', await page.locator('[role="dialog"]').count())
await b.close()
