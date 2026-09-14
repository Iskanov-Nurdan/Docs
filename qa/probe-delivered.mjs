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

const tabs = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).map(n=>n.textContent.trim()))
const rows = async () => page.evaluate(() => {
  const map = new Map()
  document.querySelectorAll('[role="gridcell"]').forEach((n) => {
    const t = n.textContent.trim(); if (!t) return
    const top = parseInt(n.style.top); if (!map.has(top)) map.set(top, [])
    map.get(top).push(t)
  })
  return Array.from(map.entries()).sort((a,b)=>a[0]-b[0]).map(([,v]) => v.join(' | '))
})
console.log('листы до:', JSON.stringify(await tabs()))
console.log('строк в журнале:', (await rows()).length)

// Множественный выбор в колонке «Через» (пятая колонка, x≈460).
await page.locator('[role="grid"]').dblclick({ position: { x: 460, y: 44 } })
await page.waitForTimeout(800)
const multi = await page.evaluate(() => document.body.innerText.includes('Точки по пути — отметьте нужные'))
console.log('множественный выбор открылся:', multi)
if (multi) {
  for (const name of ['Кашгар','Нарын']) {
    const btn = page.locator('button').filter({ hasText: new RegExp(`^${name}$`) }).last()
    await btn.click({ force: true }).catch(()=>{})
    await page.waitForTimeout(200)
  }
  await page.getByRole('button', { name: 'Готово' }).click()
  await page.waitForTimeout(700)
  const via = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
    .find(n => n.textContent.includes('→'))?.textContent.trim())
  console.log('в ячейке «Через»:', via)
}

// Приёмка второй строки.
await page.locator('[role="grid"]').click({ position: { x: 60, y: 44 } })
await page.getByTitle('Отметить прибытие машины в текущей строке').click()
await page.waitForTimeout(1500)
console.log('сообщение:', (await page.locator('body').innerText()).split('\n').find(l => l.includes('Принято') || l.includes('прибыти')) || 'нет')
console.log('листы после:', JSON.stringify(await tabs()))
console.log('строк в журнале:', (await rows()).length)

const delivered = page.getByRole('tab', { name: 'Груз прибыл' })
if (await delivered.count() > 0) {
  await delivered.click(); await page.waitForTimeout(900)
  console.log('на листе «Груз прибыл»:')
  ;(await rows()).forEach(r => console.log('   ', r))
}
await page.screenshot({ path:'qa/shots/delivered.png' })
await b.close()
