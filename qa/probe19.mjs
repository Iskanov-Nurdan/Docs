import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)

// Список значений для столбца D.
await page.getByLabel('Действия со столбцом D').click()
await page.getByRole('menuitem', { name:/Список значений/ }).click()
await page.waitForTimeout(500)
const dlg = page.getByRole('dialog')
await dlg.locator('textarea').fill(['В пути','Прибыл'].join(String.fromCharCode(10)))
await dlg.getByRole('button', { name:'Сохранить' }).click()
await page.waitForTimeout(600)
console.log('окно закрылось:', await dlg.count() === 0)

// Открываем ячейку D2.
await page.locator('[role="grid"]').dblclick({ position:{ x:360, y:44 } })
await page.waitForTimeout(700)
const listed = await page.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button')).filter(b => ['В пути','Прибыл'].includes(b.textContent.trim()))
  return buttons.map(b => {
    const r = b.getBoundingClientRect()
    const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2)
    return { текст: b.textContent.trim(), координаты: [Math.round(r.x), Math.round(r.y)], доступна: top === b || b.contains(top) }
  })
})
console.log('кнопки списка:', JSON.stringify(listed))
if (listed.length) {
  const btn = page.locator('button', { hasText: /^Прибыл$/ }).last()
  await btn.click({ timeout: 5000 }).catch(e => console.log('клик:', e.message.split('\n')[0]))
  await page.waitForTimeout(600)
  const cells = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).filter(n=>n.textContent.trim()).map(n=>`${n.style.left}/${n.style.top}=${n.textContent.trim()}`))
  console.log('ячейки после выбора:', JSON.stringify(cells))
}
await page.screenshot({ path:'qa/shots/probe19-values.png' })
await b.close()
