/** Поведение интерфейса при сбоях: 500, обрыв сети, протухшая сессия, двойной клик. */
import { chromium } from 'playwright'

const BASE = 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (bug, name, detail = '') => console.log(`${bug ? 'BUG ' : 'ok  '} ${name}${detail ? ` — ${detail}` : ''}`)
const text = (page) => page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' })
const page = await ctx.newPage()
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)))
const api = async (method, path, data) => {
  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data })
  return { status: r.status(), body: await r.json().catch(() => null) }
}
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', USER.email)
await page.fill('input[type="password"]', USER.password)
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
const created = []

try {
  // 1. Список документов отвечает 500
  await page.route(/\/api\/documents\/(\?.*)?$/, (r) => (r.request().method() === 'GET'
    ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"Внутренняя ошибка сервера.","code":"server_error"}' })
    : r.continue()))
  await page.goto(`${BASE}/documents`); await sleep(1500)
  let t = await text(page)
  out(!/ошибк|не удалось|повтор/i.test(t), 'Список при 500 показывает ошибку', t.match(/[^.]{0,40}(ошибк|не удалось|повтор)[^.]{0,60}/i)?.[0])
  await page.unroute(/\/api\/documents\/(\?.*)?$/)

  // 2. Обрыв сети при открытии таблицы
  const doc = (await api('POST', '/documents/', { title: 'PROBE сбои' })).body; created.push(doc.id)
  await page.route(`**/api/documents/${doc.id}/`, (r) => r.abort('internetdisconnected'))
  await page.goto(`${BASE}/documents/${doc.id}`); await sleep(2000)
  t = await text(page)
  out(!/нет связи/i.test(t), 'Таблица при обрыве сети пишет про связь, а не «не найден»', t.slice(0, 160))
  await page.unroute(`**/api/documents/${doc.id}/`)
  const retry = page.getByRole('button', { name: 'Повторить' })
  if (await retry.count()) { await retry.click(); await sleep(2000) }
  out(!(await page.locator('[role="grid"]').count()), 'После «Повторить» таблица открывается', (await text(page)).slice(0, 80))

  // 3. Логин при недоступном сервере
  const ctx2 = await browser.newContext({ locale: 'ru-RU' }); const p2 = await ctx2.newPage()
  await p2.route('**/api/auth/login/', (r) => r.abort('connectionrefused'))
  await p2.goto(`${BASE}/login`); await p2.fill('input[type="email"]', USER.email); await p2.fill('input[type="password"]', USER.password)
  await p2.click('button[type="submit"]'); await sleep(1200)
  const t2 = await p2.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  const btn = await p2.locator('button[type="submit"]').isDisabled()
  out(!/не удалось|ошибк|сервер|сети/i.test(t2) || btn, 'Вход при недоступном сервере: сообщение и кнопка снова активна', `${t2.match(/[^.]*(Не удалось|ошибк|сервер)[^.]*/i)?.[0] ?? 'нет сообщения'}; disabled=${btn}`)
  await ctx2.close()

  // 4. Протухшая сессия: оба токена испорчены → на вход, без зависания
  const ctx3 = await browser.newContext({ locale: 'ru-RU' }); const p3 = await ctx3.newPage()
  await p3.goto(`${BASE}/login`)
  await p3.evaluate(() => { localStorage.setItem('docs.access', 'bad'); localStorage.setItem('docs.refresh', 'bad') })
  await p3.goto(`${BASE}/documents`); await sleep(2500)
  out(!/\/login/.test(p3.url()), 'Протухшая сессия отправляет на вход', p3.url().replace(BASE, ''))
  await ctx3.close()

  // 5. Только access протух — refresh должен тихо продлить сессию
  await page.evaluate(() => localStorage.setItem('docs.access', 'bad'))
  await page.goto(`${BASE}/documents`); await sleep(2500)
  out(/\/login/.test(page.url()), 'Протухший access продлевается по refresh', page.url().replace(BASE, ''))

  // 6. Двойной клик «Создать таблицу» не создаёт две
  const before = (await api('GET', '/documents/?page_size=100')).body.count
  const create = page.getByRole('button', { name: /Создать таблицу/ }).first()
  await create.dblclick(); await sleep(2500)
  const list = (await api('GET', '/documents/?page_size=100')).body
  const made = list.results.filter((d) => d.title === 'Без названия' || /Новая/.test(d.title)).slice(0, list.count - before)
  for (const d of made) created.push(d.id)
  out(list.count - before > 1, 'Двойной клик «Создать таблицу» создаёт одну', `создано: ${list.count - before}`)

  out(pageErrors.length > 0, 'Без необработанных исключений на странице', pageErrors.join(' | ').slice(0, 200))
} finally {
  await page.unrouteAll().catch(() => {})
  for (const id of created) { await api('DELETE', `/documents/${id}/`); await api('DELETE', `/documents/${id}/?permanent=true`) }
  await browser.close()
}
