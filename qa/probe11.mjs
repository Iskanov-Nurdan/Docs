import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
page.on('pageerror', e => console.log('PAGEERROR:', e.message))
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)
const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(160,20,'Summa'); await type(160,44,'10'); await type(160,68,'20'); await type(160,92,'30')
await page.waitForTimeout(500)

const snap = async (label) => {
  const info = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('[role="tab"]')).map(n=>n.textContent.trim()),
    cells: Array.from(document.querySelectorAll('[role="gridcell"]')).filter(n=>n.textContent.trim())
      .map(n=>`${n.style.left}/${n.style.top}=${n.textContent.trim()}`),
    rowLabels: Array.from(document.querySelectorAll('[role="grid"] ~ *')).length,
  }))
  console.log(label, JSON.stringify(info.tabs), '| ячейки:', JSON.stringify(info.cells))
}
await snap('до сортировки:')
await page.getByLabel('Действия со столбцом B').click()
await page.getByRole('menuitem', { name:'Сортировать по убыванию' }).click()
await page.waitForTimeout(1200)
await snap('сразу после:')
await page.waitForTimeout(2500)
await snap('через 2.5 с:')
await page.reload(); await page.waitForTimeout(3500)
await snap('после перезагрузки:')
await b.close()
