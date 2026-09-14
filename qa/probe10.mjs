import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
page.on('pageerror', e => console.log('PAGEERROR:', e.message))
page.on('console', m => { if (m.type()==='error') console.log('CONSOLE:', m.text().slice(0,200)) })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)

const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(160,20,'Summa'); await type(160,44,'10'); await type(160,68,'20'); await type(160,92,'30')
await page.waitForTimeout(600)
const order = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter(n=>n.style.left==='100px').sort((a,b)=>parseInt(a.style.top)-parseInt(b.style.top)).map(n=>n.textContent.trim()))
console.log('до сортировки:', JSON.stringify(await order()))

await page.getByLabel('Действия со столбцом B').click()
await page.waitForTimeout(400)
const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map(n=>({t:n.textContent.trim(), disabled:n.disabled})))
console.log('пункты меню:', JSON.stringify(items))
await page.getByRole('menuitem', { name:'Сортировать по убыванию' }).click()
await page.waitForTimeout(800)
console.log('после сортировки:', JSON.stringify(await order()))
await page.screenshot({ path:'qa/shots/probe10-sort.png' })
await b.close()
