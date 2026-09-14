import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)
const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(160,20,'Summa'); await type(160,44,'10'); await type(160,68,'20')
await page.getByLabel('Действия со столбцом B').click()
await page.getByRole('menuitem', { name:'Фильтр…' }).click()
await page.waitForTimeout(800)
const diag = await page.evaluate(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Снять все')
  if (!btn) return 'кнопки нет'
  const r = btn.getBoundingClientRect()
  const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)
  const layers = Array.from(document.querySelectorAll('body > *')).map(n => `${n.tagName}.${String(n.className).slice(0,40)}`)
  return {
    кнопка: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    сверху: top === btn ? 'сама кнопка' : `${top?.tagName}.${String(top?.className).slice(0,70)}`,
    слои: layers,
  }
})
console.log(JSON.stringify(diag, null, 1))
await page.screenshot({ path: 'qa/shots/probe18-filter-dialog.png' })
await b.close()
