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
const cells = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter(n=>n.textContent.trim()).map(n=>`${n.style.left}/${n.style.top}=${n.textContent.trim()}`))
const rowsInfo = async () => page.evaluate(() => ({
  gridcells: document.querySelectorAll('[role="gridcell"]').length,
  rowNumbers: Array.from(document.querySelectorAll('[role="grid"]')).length,
}))
console.log('до:', JSON.stringify(await cells()), JSON.stringify(await rowsInfo()))

await page.getByLabel('Действия со столбцом B').click()
await page.getByRole('menuitem', { name:'Сортировать по убыванию' }).click()
await page.waitForTimeout(1000)
console.log('после сортировки:', JSON.stringify(await cells()), JSON.stringify(await rowsInfo()))

// Любое действие, вызывающее перерисовку: клик по ячейке.
await page.locator('[role="grid"]').click({ position:{x:60,y:20} })
await page.waitForTimeout(500)
console.log('после клика:', JSON.stringify(await cells()))

// Ввод нового значения.
await type(360,20,'NEW')
await page.waitForTimeout(600)
console.log('после ввода NEW:', JSON.stringify(await cells()))
await b.close()
