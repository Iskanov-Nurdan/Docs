import { chromium } from 'playwright'
const BASE = 'http://localhost:8080'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)) })

await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'qa@test.local')
await page.fill('input[type="password"]', 'QaTest12345!')
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
await page.getByRole('button', { name: 'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/)
await page.waitForTimeout(2000)

const dump = async (label) => {
  const cells = await page.evaluate(() => {
    const out = []
    document.querySelectorAll('[role="gridcell"]').forEach((n) => {
      const text = n.textContent.trim()
      if (text) out.push({ text, top: n.style.top, left: n.style.left })
    })
    return out
  })
  console.log(label, JSON.stringify(cells))
}

// Вводим столбец чисел, как это делает тест.
await page.locator('[role="grid"]').click({ position: { x: 160, y: 20 } })
await page.keyboard.type('Сумма'); await page.keyboard.press('Enter')
for (const v of ['10', '20', '30']) { await page.keyboard.type(v); await page.keyboard.press('Enter') }
await page.waitForTimeout(500)
await dump('после ввода чисел:')

// Адрес текущей ячейки — чтобы понять, куда встал курсор.
console.log('адрес ячейки:', await page.getByLabel('Выделенный диапазон').innerText())

await page.keyboard.type('=СУММ(B2:B4)')
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
await dump('после формулы:')

await page.screenshot({ path: 'qa/shots/probe2-formula.png' })
await browser.close()
