/** Охота на баги, часть 2: буфер обмена, телефон, офлайн, одновременная правка. */
import { chromium, devices } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = 'http://localhost:8080'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
mkdirSync('shots/bughunt', { recursive: true })
const out = (bug, name, detail) => console.log(`${bug ? 'BUG ' : 'ok  '} ${name} — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)

async function login(page, email) {
  await page.goto(`${BASE}/login`, { timeout: 90000 })
  await page.fill('input[type="email"]', email)
  await page.fill('input[type="password"]', 'QaTest12345!')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 30000 })
}
const auth = async (page) => ({ Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('docs.access'))}` })
async function newDoc(page, title) {
  const doc = await (await page.request.post(`${BASE}/api/documents/`, { headers: await auth(page), data: { title } })).json()
  await page.goto(`${BASE}/documents/${doc.id}`)
  await page.locator('[role="grid"]').waitFor({ timeout: 30000 })
  await sleep(800)
  return doc.id
}
const grid = (page) => page.locator('[role="grid"]')
async function type(page, col, row, text) {
  await grid(page).click({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await sleep(300)
  await grid(page).dblclick({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await sleep(200)
}
async function cell(page, col, row) {
  return page.evaluate(({ l, t }) => {
    const n = Array.from(document.querySelectorAll('[role="gridcell"]')).find((x) => x.style.left === `${l}px` && x.style.top === `${t}px`)
    return n ? n.textContent.trim() : null
  }, { l: col * 100, t: row * 24 })
}
async function formulaOf(page, col, row) {
  await grid(page).click({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await sleep(250)
  return page.getByLabel('Строка формул').inputValue()
}

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
await login(page, 'qa@test.local')

// --- 1. Копирование формулы на другую строку ---
const id1 = await newDoc(page, 'BUGHUNT буфер')
await type(page, 0, 0, 'Кол-во')
await type(page, 1, 0, 'Цена')
await type(page, 2, 0, 'Итог')
await type(page, 0, 1, '2'); await type(page, 1, 1, '10'); await type(page, 2, 1, '=A2*B2')
await type(page, 0, 2, '3'); await type(page, 1, 2, '20')
await grid(page).click({ position: { x: 230, y: 1 * 24 + 12 } }); await sleep(250)
await page.keyboard.press('Control+c'); await sleep(250)
await grid(page).click({ position: { x: 230, y: 2 * 24 + 12 } }); await sleep(250)
await page.keyboard.press('Control+v'); await sleep(600)
const pasted = await formulaOf(page, 2, 2)
out(pasted !== '=A3*B3', 'Ctrl+C/Ctrl+V формулы на строку ниже сдвигает ссылки, как в Excel', { вставилось: pasted, показано: await cell(page, 2, 2), ждали: '=A3*B3 → 60' })

// --- 2. Вставка большого куска из Excel (500×20) ---
const big = Array.from({ length: 500 }, (_, r) => Array.from({ length: 20 }, (_, c) => `r${r}c${c}`).join('\t')).join('\n')
await grid(page).click({ position: { x: 30, y: 5 * 24 + 12 } }); await sleep(250)
await page.evaluate((text) => navigator.clipboard.writeText(text), big)
const started = Date.now()
await page.keyboard.press('Control+v')
await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="gridcell"]')).some((n) => n.textContent.trim() === 'r0c0'), null, { timeout: 30000 }).catch(() => {})
const took = Date.now() - started
out(took > 5000, 'Вставка 500×20 из буфера укладывается в 5 секунд', `${took} мс`)

// --- 3. Телефон: редактор ---
const phone = await browser.newContext({ ...devices['iPhone 13'] })
const mobile = await phone.newPage()
await login(mobile, 'qa@test.local')
await mobile.goto(`${BASE}/documents/${id1}`)
await mobile.locator('[role="grid"]').waitFor({ timeout: 30000 })
await sleep(1000)
const box = await mobile.locator('[role="grid"]').boundingBox()
const viewport = mobile.viewportSize()
await mobile.screenshot({ path: 'shots/bughunt/phone-editor.png' })
out(!box || box.height < viewport.height * 0.35, 'На телефоне таблице остаётся хотя бы треть экрана', { высота_сетки: box?.height, экран: viewport.height })
const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
out(overflow > 2, 'На телефоне страница не прокручивается вбок целиком', `лишняя ширина ${overflow}px`)
await phone.close()

// --- 4. Одновременная правка одной ячейки двумя людьми ---
const ctxB = await browser.newContext({ viewport: { width: 1500, height: 900 } })
const pageB = await ctxB.newPage()
await login(pageB, 'qa2@test.local')
const id2 = await newDoc(page, 'BUGHUNT одновременно')
await pageB.goto(`${BASE}/documents/${id2}`)
await grid(pageB).waitFor({ timeout: 30000 })
await sleep(1500)
await Promise.all([type(page, 0, 1, 'от A'), type(pageB, 0, 1, 'от B')])
await sleep(2500)
const a = await cell(page, 0, 1)
const b = await cell(pageB, 0, 1)
out(a !== b, 'После одновременной правки одной ячейки у обоих одинаковое значение', { у_A: a, у_B: b })

// --- 5. Офлайн: правка без сети уходит после восстановления ---
await ctx.setOffline(true)
await sleep(800)
await type(page, 1, 1, 'без сети')
await sleep(800)
await ctx.setOffline(false)
const synced = await (async () => {
  const until = Date.now() + 20000
  while (Date.now() < until) {
    if ((await cell(pageB, 1, 1)) === 'без сети') return true
    await sleep(500)
  }
  return false
})()
out(!synced, 'Правка, сделанная без сети, доходит до соседа после восстановления (за 20 с)', synced ? 'дошла' : 'не дошла')

// --- 6. Перезагрузка страницы сразу после правки ---
await type(page, 2, 1, 'перед F5')
await page.reload()
await grid(page).waitFor({ timeout: 30000 })
await sleep(1500)
const afterReload = await cell(page, 2, 1)
out(afterReload !== 'перед F5', 'Правка сохраняется, если сразу нажать F5', { после: afterReload })

for (const id of [id1, id2]) await page.request.delete(`${BASE}/api/documents/${id}/`, { headers: await auth(page) })
await browser.close()
