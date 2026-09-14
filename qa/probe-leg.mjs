import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const page = await (await b.newContext({ viewport:{width:1400,height:900}, locale:'ru-RU' })).newPage()
page.on('request', r => { if (r.url().includes('route-legs') && r.method()==='POST') console.log('ЗАПРОС:', r.postData()) })
page.on('response', async r => { if (r.url().includes('route-legs') && r.request().method()==='POST') console.log('ОТВЕТ', r.status(), (await r.text()).slice(0,300)) })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa-admin@test.local'); await page.fill('input[type="password"]','QaAdmin12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.goto(`${BASE}/routes`); await page.waitForTimeout(2500)

const state = await page.evaluate(() => {
  const selects = Array.from(document.querySelectorAll('[role="combobox"]')).map(n => ({ label: n.getAttribute('aria-label'), text: n.textContent.trim() }))
  return { selects, точек: document.body.innerText.match(/Точки \((\d+)\)/)?.[1] }
})
console.log('состояние:', JSON.stringify(state))

await page.locator('input[placeholder="10"]').fill('4')
await page.getByRole('button', { name: 'Добавить' }).click()
await page.waitForTimeout(2000)
console.log('сообщение:', (await page.locator('body').innerText()).split('\n').find(l => /Не удалось|сохранён|Укажите/.test(l)) || 'нет')
await b.close()
