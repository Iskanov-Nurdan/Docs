import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()
const page = await (await b.newContext({ viewport:{width:1400,height:900}, locale:'ru-RU' })).newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa-admin@test.local'); await page.fill('input[type="password"]','QaAdmin12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.goto(`${BASE}/routes`); await page.waitForTimeout(2500)

await page.getByLabel('Откуда').click()
await page.waitForTimeout(600)
const info = await page.evaluate(() => {
  const list = document.querySelector('[role="listbox"]')
  if (!list) return 'списка нет'
  const r = list.getBoundingClientRect()
  const options = Array.from(list.querySelectorAll('[role="option"]'))
  const osh = options.find(o => o.textContent.trim() === 'Ош')
  const or = osh?.getBoundingClientRect()
  return {
    список: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    экран: [innerWidth, innerHeight],
    прокрутка: list.scrollHeight > list.clientHeight,
    пунктОш: or ? [Math.round(or.x), Math.round(or.y), Math.round(or.height)] : 'нет',
    внутриЭкрана: or ? (or.y >= 0 && or.y + or.height <= innerHeight) : null,
    стиль: list.getAttribute('style'),
    кнопка: (() => { const btn = document.querySelector('[aria-label="Откуда"]'); const b = btn.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.height)] })(),
  }
})
console.log(JSON.stringify(info, null, 1))
await page.screenshot({ path:'qa/shots/select-open.png' })
await b.close()
