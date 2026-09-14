import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)
const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(160,20,'Summa'); await type(160,44,'10')

await page.getByLabel('Действия со столбцом B').click()
await page.waitForTimeout(500)
const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map((n) => ({
  text: n.textContent.trim(),
  disabled: n.disabled,
  rect: n.getBoundingClientRect().toJSON(),
})))
console.log('пункты:', JSON.stringify(items.map(i => `${i.text} disabled=${i.disabled} x=${Math.round(i.rect.x)} y=${Math.round(i.rect.y)} w=${Math.round(i.rect.width)}`), null, 0))
const overlay = await page.evaluate(() => {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find(n => n.textContent.includes('Фильтр'))
  if (!item) return 'пункт не найден'
  const r = item.getBoundingClientRect()
  const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)
  return top === item ? 'пункт доступен' : `перекрыт: ${top?.tagName}.${top?.className?.toString().slice(0,60)}`
})
console.log('проверка перекрытия:', overlay)
await b.close()
