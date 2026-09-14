import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch()

const open = async (who) => {
  const page = await (await b.newContext({ viewport:{width:1400,height:900}, locale:'ru-RU' })).newPage()
  page.on('pageerror', e => console.log('PAGEERROR:', e.message))
  await page.goto(`${BASE}/login`)
  await page.fill('input[type="email"]', who.email); await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
  await page.goto(`${BASE}/routes`); await page.waitForTimeout(2500)
  return page
}

console.log('=== АДМИН ===')
const admin = await open({ email:'qa-admin@test.local', password:'QaAdmin12345!' })
const adminView = await admin.evaluate(() => ({
  точек: document.body.innerText.match(/Точки \((\d+)\)/)?.[1],
  маршрутов: document.body.innerText.match(/Время в пути \((\d+)\)/)?.[1],
  естьПолеТочки: Boolean(document.querySelector('input[placeholder*="Кашгар"]')),
  естьКнопкаДобавить: Array.from(document.querySelectorAll('button')).some(b => b.textContent.trim() === 'Добавить'),
}))
console.log(JSON.stringify(adminView))

// Заводим свою точку и маршрут — как это сделает администратор.
await admin.fill('input[placeholder*="Кашгар"]', 'Сары-Таш')
await admin.keyboard.press('Enter')
await admin.waitForTimeout(1500)
console.log('после добавления точки:', (await admin.locator('body').innerText()).match(/Точки \((\d+)\)/)?.[1])

const before = (await admin.locator('body').innerText()).match(/Время в пути \((\d+)\)/)?.[1]
await admin.getByLabel('Откуда', { exact: true }).scrollIntoViewIfNeeded()
await admin.getByLabel('Откуда', { exact: true }).click()
await admin.getByRole('option', { name: 'Ош' }).first().click()
await admin.getByLabel('Куда', { exact: true }).scrollIntoViewIfNeeded()
await admin.getByLabel('Куда', { exact: true }).click()
await admin.getByRole('option', { name: 'Сары-Таш' }).first().click()
await admin.locator('input[placeholder="10"]').fill('4')
await admin.getByRole('button', { name: 'Добавить' }).click()
await admin.waitForTimeout(1800)
const after = (await admin.locator('body').innerText()).match(/Время в пути \((\d+)\)/)?.[1]
console.log(`маршрутов было ${before}, стало ${after} (ждём +2: туда и обратно)`)
await admin.screenshot({ path:'qa/shots/routes-admin.png' })

console.log('\n=== ОБЫЧНЫЙ СОТРУДНИК ===')
const user = await open({ email:'qa@test.local', password:'QaTest12345!' })
const userView = await user.evaluate(() => ({
  видитТочки: document.body.innerText.includes('Точки ('),
  видитВремя: document.body.innerText.includes('Сары-Таш'),
  можетДобавлятьТочку: Boolean(document.querySelector('input[placeholder*="Кашгар"]')),
  естьКорзины: document.querySelectorAll('[aria-label^="Удалить"]').length,
}))
console.log(JSON.stringify(userView))
await user.screenshot({ path:'qa/shots/routes-user.png' })
await b.close()
