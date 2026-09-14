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

const rowsBefore = await page.evaluate(() => document.querySelectorAll('[role="gridcell"]').length)
await page.getByTitle('Добавить запись формой').click()
await page.waitForTimeout(800)
const dlg = page.getByRole('dialog')
console.log('поля:', (await dlg.innerText()).replace(/\n+/g,' | ').slice(0, 200))

// Заполняем рейс Бишкек → Нарын → Каракол.
const field = (label) => dlg.locator('label').filter({ hasText: new RegExp(`^${label}`) }).locator('input').first()
await field('Дата').fill('14.09.2026').catch(()=>{})
await field('Машина').fill('AA46554')
await field('Откуда').fill('Бишкек')
await dlg.getByRole('button', { name: 'Точка по пути' }).click()
await page.waitForTimeout(300)
await dlg.locator('input[placeholder="Пункт"]').fill('Нарын')
await field('Куда').fill('Каракол')
await field('Вышел').fill('08:00')
await page.waitForTimeout(600)
console.log('подсказка:', (await dlg.innerText()).split('\n').find(l => l.includes('посчитаем')) || 'нет')
console.log('итог:', (await dlg.innerText()).split('\n').find(l => l.includes('одной записью') || l.includes('Весь путь')) || 'нет')

await dlg.getByRole('button', { name: 'Добавить', exact: true }).click()
await page.waitForTimeout(1500)

const added = await page.evaluate(() => {
  const cells = Array.from(document.querySelectorAll('[role="gridcell"]'))
  const rows = new Map()
  cells.forEach((n) => { const t = n.textContent.trim(); if (!t) return
    const top = parseInt(n.style.top); if (!rows.has(top)) rows.set(top, [])
    rows.get(top).push(`${parseInt(n.style.left)}:${t}`) })
  return Array.from(rows.entries()).sort((a,b)=>a[0]-b[0]).map(([t,v]) => `${t}px  ${v.join(' | ')}`)
})
console.log('\nстроки таблицы:')
added.forEach(r => console.log('  ', r))
await page.screenshot({ path:'qa/shots/via-result.png' })
await b.close()
