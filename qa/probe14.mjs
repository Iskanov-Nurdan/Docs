import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)
const h = async () => page.evaluate(() => ({
  высота: document.querySelector('[role="grid"] > div')?.style.height,
  строкВСписке: document.querySelectorAll('[role="grid"]')[0]?.getAttribute('aria-rowcount'),
  прокрутка: document.querySelector('[role="grid"]')?.scrollTop,
}))
console.log('старт:      ', JSON.stringify(await h()))
const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(160,20,'Summa'); await type(160,44,'10'); await type(160,68,'20'); await type(160,92,'30')
console.log('после ввода:', JSON.stringify(await h()))
await page.getByLabel('Действия со столбцом B').click()
await page.waitForTimeout(300)
console.log('меню открыто:', JSON.stringify(await h()))
await page.keyboard.press('Escape'); await page.waitForTimeout(300)
console.log('меню закрыто:', JSON.stringify(await h()))
await page.getByLabel('Действия со столбцом B').click()
await page.getByRole('menuitem', { name:'Сортировать по убыванию' }).click()
await page.waitForTimeout(1200)
console.log('после сорт.:', JSON.stringify(await h()))
await b.close()
