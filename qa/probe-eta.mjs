import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const page = await (await b.newContext({ viewport:{width:1400,height:900}, locale:'ru-RU' })).newPage()
page.on('pageerror', e => console.log('PAGEERROR:', e.message))
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(2500)

const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
// Шапка журнала.
const head = ['Дата','Машина','Откуда','Куда','Вышел','Прибытие','Статус']
for (let i = 0; i < head.length; i += 1) await type(60 + i*100, 20, head[i])
await page.waitForTimeout(400)

// Строка рейса: дата, машина, откуда, время выезда.
await type(60, 44, '09.09.2026')
await type(160, 44, '01KG777AAA')
await type(260, 44, 'Ош')
await type(460, 44, '08:30')
await page.waitForTimeout(300)

const cells = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter(n=>n.textContent.trim()).map(n=>`${n.style.left}/${n.style.top}=${n.textContent.trim()}`))
console.log('до выбора «Куда»:', JSON.stringify((await cells()).filter(c=>c.includes('/24px='))))

// Выбираем «Куда» — список точек должен предложиться сам.
await page.locator('[role="grid"]').dblclick({ position: { x: 360, y: 44 } })
await page.waitForTimeout(700)
const suggestions = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
  .filter(b => ['Бишкек','Ош','Кашгар','Ташкент'].includes(b.textContent.trim()))
  .map(b => b.textContent.trim()))
console.log('предложены точки:', JSON.stringify(suggestions.slice(0, 6)))

const bishkek = page.locator('button').filter({ hasText: /^Бишкек$/ }).last()
if (await bishkek.count() > 0) { await bishkek.click() } else { await page.keyboard.type('Бишкек'); await page.keyboard.press('Enter') }
await page.waitForTimeout(1200)

console.log('после выбора:   ', JSON.stringify((await cells()).filter(c=>c.includes('/24px='))))
console.log('сообщение:', (await page.locator('body').innerText()).split('\n').find(l => l.includes('прибытие')) || 'нет')
await page.screenshot({ path:'qa/shots/eta-filled.png' })
await b.close()
