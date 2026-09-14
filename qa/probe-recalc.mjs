import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const page = await (await b.newContext({ viewport:{width:1400,height:900}, locale:'ru-RU' })).newPage()
page.on('pageerror', e => console.log('PAGEERROR:', e.message))
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa-admin@test.local'); await page.fill('input[type="password"]','QaAdmin12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.goto(`${BASE}/templates`); await page.waitForTimeout(1500)
await page.getByText('Журнал рейсов').first().click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(3000)

const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
// Пятая строка: точки есть, времени выезда нет — как у него.
await type(60, 116, '14.09.2026')
await type(160, 116, '01KG903CCC')
await type(360, 116, 'Алай')
await type(460, 116, 'Кара-Тай')
await type(560, 116, 'Достук')
await page.waitForTimeout(1200)

const row5 = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter(n => n.style.top === '96px' && n.textContent.trim())
  .sort((a,b)=>parseInt(a.style.left)-parseInt(b.style.left))
  .map(n => n.textContent.trim()).join(' | '))
console.log('после выбора точек:', await row5())
console.log('сообщение:', (await page.locator('body').innerText()).split('\n').find(l => l.includes('прибытие') || l.includes('Посчитано')) || 'нет')

await page.getByTitle('Посчитать сроки прибытия по справочнику').click()
await page.waitForTimeout(1500)
console.log('после пересчёта:  ', await row5())
console.log('сообщение:', (await page.locator('body').innerText()).split('\n').find(l => l.includes('Посчитано') || l.includes('Считать нечего')) || 'нет')
await page.screenshot({ path:'qa/shots/recalc.png' })
await b.close()
