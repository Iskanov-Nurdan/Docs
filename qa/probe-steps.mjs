import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const page = await (await b.newContext({ viewport:{width:1500,height:900}, locale:'ru-RU' })).newPage()
page.on('pageerror', e => console.log('PAGEERROR:', e.message))
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa-admin@test.local'); await page.fill('input[type="password"]','QaAdmin12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)

// Заводим недостающее плечо, чтобы расчёт сложился.
const token = await page.evaluate(() => localStorage.getItem('docs.access'))
const places = await (await page.request.get(`${BASE}/api/places/`, { headers:{Authorization:`Bearer ${token}`} })).json()
const id = (name) => places.find(p => p.name === name)?.id
if (id('Кара-Тай') && id('Достук')) {
  await page.request.post(`${BASE}/api/route-legs/`, { headers:{Authorization:`Bearer ${token}`},
    data: { origin: id('Кара-Тай'), destination: id('Достук'), hours: 5 } })
}

await page.goto(`${BASE}/templates`); await page.waitForTimeout(1500)
await page.getByText('Журнал рейсов').first().click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); await page.waitForTimeout(3000)

const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(60, 116, '14.09.2026'); await type(160, 116, 'AA12345')
await type(360, 116, 'Алай'); await type(460, 116, 'Кара-Тай'); await type(560, 116, 'Достук')
await type(660, 116, '08:00')
await page.waitForTimeout(1000)

const row = async () => page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]'))
  .filter(n => n.style.top === '96px' && n.textContent.trim())
  .sort((a,b)=>parseInt(a.style.left)-parseInt(b.style.left))
  .map(n => n.textContent.trim()).join(' | '))
const say = async () => (await page.locator('body').innerText()).split('\n').find(l => /Прошли|прибытие|Принято|нет участка/.test(l)) || 'нет'

console.log('рейс:', await row())
await page.locator('[role="grid"]').click({ position: { x: 60, y: 116 } })
await page.getByTitle('Отметить прибытие машины в текущей строке').click()
await page.waitForTimeout(1500)
console.log('\n1-е нажатие:', await say())
console.log('строка:    ', await row())

await page.getByTitle('Отметить прибытие машины в текущей строке').click()
await page.waitForTimeout(1800)
console.log('\n2-е нажатие:', await say())
const tabs = await page.evaluate(() => Array.from(document.querySelectorAll('[role="tab"]')).map(n=>n.textContent.trim()))
console.log('листы:', JSON.stringify(tabs))
await page.screenshot({ path:'qa/shots/checkpoints.png' })
await b.close()
