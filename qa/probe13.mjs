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
const info = async (label) => {
  const d = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
    const tops = cells.map(n => parseInt(n.style.top)).filter(v => !Number.isNaN(v))
    const rowNums = Array.from(document.querySelectorAll('div[role="grid"]')).length
    const numbers = Array.from(document.querySelectorAll('[role="grid"]'))
    return {
      всего: cells.length,
      непустых: cells.filter(n => n.textContent.trim()).length,
      maxTop: Math.max(...tops, 0),
      первые: cells.slice(0, 4).map(n => `${n.style.left}/${n.style.top}="${n.textContent.trim()}"`),
      высотаЛиста: document.querySelector('[role="grid"] > div')?.style.height,
    }
  })
  console.log(label, JSON.stringify(d))
}
await info('до:')
await page.getByLabel('Действия со столбцом B').click()
await page.getByRole('menuitem', { name:'Сортировать по убыванию' }).click()
await page.waitForTimeout(1500)
await info('после:')
await b.close()
