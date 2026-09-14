import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const page = await (await b.newContext({ viewport:{width:1400,height:900}, locale:'ru-RU' })).newPage()
page.on('pageerror', e => console.log('PAGEERROR:', e.message))
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.goto(`${BASE}/templates`); await page.waitForTimeout(1500)
await page.getByText('Журнал рейсов').first().click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(3000)

const rows = async () => page.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
  const byRow = new Map()
  cells.forEach((n) => {
    const text = n.textContent.trim(); if (!text) return
    const top = parseInt(n.style.top)
    if (!byRow.has(top)) byRow.set(top, [])
    byRow.get(top).push(`${parseInt(n.style.left)}:${text}`)
  })
  return Array.from(byRow.entries()).sort((a,b)=>a[0]-b[0]).slice(0,6).map(([t,v]) => `${t}px ${v.join(' | ')}`)
})
console.log('шапка:', (await rows())[0])

await page.getByTitle('Добавить запись формой').click()
await page.waitForTimeout(900)
const dlg = page.getByRole('dialog')
console.log('поля формы:', (await dlg.innerText()).replace(/\n+/g,' | ').slice(0, 260))

await dlg.locator('input').first().fill('14.09.2026')
await dlg.getByRole('button', { name: 'Точка по пути' }).click()
await page.waitForTimeout(300)
const inputs = dlg.locator('input')
const count = await inputs.count()
console.log('полей в форме:', count)
await page.screenshot({ path:'qa/shots/via-form.png' })
await b.close()
