import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); const url=page.url()
await page.waitForTimeout(2000)
await page.locator('[role="grid"]').dblclick({position:{x:60,y:20}})
await page.keyboard.type('LEAF-TEST'); await page.keyboard.press('Enter')
await page.getByLabel('К списку таблиц').click(); await page.waitForURL(/\/documents$/)
await page.waitForTimeout(2500)

// Открываем документ заново — в новой вкладке (чистая, но IndexedDB общий).
await page.goto(url); await page.waitForTimeout(3500)
const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).map(n=>n.textContent.trim()))
const cells = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).map(n=>n.textContent.trim()).filter(Boolean))
console.log('листов:', JSON.stringify(tabs), '| видно ячеек:', JSON.stringify(cells))

// И в совсем свежем контексте, без IndexedDB.
const ctx2 = await b.newContext()
const p2 = await ctx2.newPage()
await p2.goto(`${BASE}/login`)
await p2.fill('input[type="email"]','qa@test.local'); await p2.fill('input[type="password"]','QaTest12345!')
await p2.click('button[type="submit"]'); await p2.waitForURL(/\/documents/)
await p2.goto(url); await p2.waitForTimeout(4000)
const tabs2 = await p2.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).map(n=>n.textContent.trim()))
const cells2 = await p2.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).map(n=>n.textContent.trim()).filter(Boolean))
console.log('чистый браузер — листов:', JSON.stringify(tabs2), '| видно:', JSON.stringify(cells2))
await p2.screenshot({ path: 'qa/shots/probe9-fresh.png' })
await b.close()
