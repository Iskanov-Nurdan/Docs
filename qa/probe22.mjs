import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.waitForTimeout(1500)
const titles = async () => page.evaluate(() => Array.from(document.querySelectorAll('li')).map(n=>n.textContent.trim().slice(0,30)).filter(Boolean))
console.log('в списке:', JSON.stringify((await titles()).slice(0,4)))
const card = page.locator('li').filter({ hasText: 'Новая таблица' }).first()
if (await card.count() === 0) { console.log('нет документа для удаления'); await b.close(); process.exit(0) }
await card.getByLabel(/Действия/).click()
await page.waitForTimeout(400)
const items = await page.evaluate(() => Array.from(document.querySelectorAll('[role="menuitem"]')).map(n=>`${n.textContent.trim()} disabled=${n.disabled}`))
console.log('пункты:', JSON.stringify(items))
await page.getByRole('menuitem', { name:'В корзину' }).click()
await page.waitForTimeout(700)
const dlg = await page.locator('[role="dialog"]').count()
console.log('окно подтверждения:', dlg)
if (dlg) {
  console.log('текст:', (await page.locator('[role="dialog"]').innerText()).replace(/\n+/g,' | ').slice(0,150))
  const buttons = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"] button')).map(n=>n.textContent.trim()))
  console.log('кнопки:', JSON.stringify(buttons))
}
await page.screenshot({ path:'qa/shots/probe22-trash.png' })
await b.close()
