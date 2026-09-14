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
// Ровно как у него: только точки, без даты и времени.
await type(360, 116, 'Алай')
await type(460, 116, 'Кара-Тай')
await type(560, 116, 'Достук')
await page.waitForTimeout(1200)

const row5 = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter(n => n.style.top === '96px' && n.textContent.trim())
  .sort((a,b)=>parseInt(a.style.left)-parseInt(b.style.left))
  .map(n => `${parseInt(n.style.left)}:${n.textContent.trim()}`).join(' | '))
console.log('строка 5:', row5)
console.log('сообщение:', (await page.locator('body').innerText()).split('\n').find(l => l.includes('прибытие')) || 'нет')
await page.screenshot({ path:'qa/shots/from-now.png' })
await b.close()
