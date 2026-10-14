/**
 * Инвентарь интерактивных элементов по всем страницам + безопасное нажатие.
 * Только локальный docker (:8080). Созданное для проверки — убирает за собой.
 *
 * Для каждой страницы и ширины: элементы, ошибки консоли, упавшие запросы,
 * горизонтальная прокрутка, элементы за краем экрана, кнопки без имени.
 * На 1366 нажимает каждую кнопку, кроме разрушающих и создающих данные,
 * и смотрит, не появились ли ошибки. Результат — inventory-report.json.
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = 'http://localhost:8080'
const ADMIN = { email: 'qa-admin@test.local', password: 'QaAdmin12345!' }
const WIDTHS = [375, 768, 1366, 1920]
const SWEEP_WIDTH = 1366
// Удаление, выход, отзыв доступа и создание данных проверяются целевыми
// сценариями (fullclick*), а не слепым нажатием.
const UNSAFE = /удал|выйти|выход|корзин|очист|закрыть доступ|отозв|снять|создать|новая|новый|импорт|загруз|скачать|опубликовать|восстанов|сохранить|отправить|войти|сменить|изменить пароль|копи|добавить|переимен|в папку|переместить|сделать шаблон|logout|delete/i
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch()
const context = await browser.newContext({ locale: 'ru-RU' })
const page = await context.newPage()

const consoleErrors = []
const failedRequests = []
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ url: page.url(), text: m.text().slice(0, 300) }) })
page.on('pageerror', (e) => consoleErrors.push({ url: page.url(), text: `pageerror: ${String(e.message).slice(0, 300)}` }))
page.on('response', (r) => {
  if (r.status() >= 400 && r.url().startsWith(BASE)) {
    failedRequests.push({ page: page.url().replace(BASE, ''), status: r.status(), method: r.request().method(), url: r.url().replace(BASE, '') })
  }
})

const api = async (method, path, data) => {
  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const r = await page.request.fetch(`${BASE}/api${path}`, { method, headers: { Authorization: `Bearer ${token}` }, data })
  return { status: r.status(), body: await r.json().catch(() => null) }
}

// --- Анонимные страницы ---
const anonRoutes = ['/login', '/forgot-password', '/reset-password', '/confirm-email']

// --- Вход и тестовые объекты ---
await page.setViewportSize({ width: 1366, height: 900 })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', ADMIN.email)
await page.fill('input[type="password"]', ADMIN.password)
await page.click('button[type="submit"]')
await page.waitForURL(/\/documents/)
const doc = (await api('POST', '/documents/', { title: 'INVENTORY таблица' })).body
const folder = (await api('POST', '/folders/', { name: 'INVENTORY папка' })).body
const pub = (await api('POST', `/documents/${doc.id}/publish/`, { auto_update: false })).body

const authRoutes = [
  '/documents', '/shared', '/starred', '/templates', '/trash', '/routes', '/settings',
  '/download', '/admin', '/accountant', `/folders/${folder.id}`, `/documents/${doc.id}`,
  `/public/document/${pub.public_id}`, '/no-such-page',
]

const inventoryScript = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'
  }
  const scrollsX = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX
      if (o === 'auto' || o === 'scroll' || o === 'hidden') return true
    }
    return false
  }
  const nameOf = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder')
    || el.getAttribute('title') || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 60)
  const selector = 'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [role="combobox"], [role="option"]'
  const items = []
  const vw = window.innerWidth
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el)) continue
    const r = el.getBoundingClientRect()
    items.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      name: nameOf(el),
      disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
      offscreen: (r.right > vw + 1 || r.left < -1) && !scrollsX(el),
      small: (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && (r.width < 24 || r.height < 24),
    })
  }
  return {
    items,
    hScroll: document.documentElement.scrollWidth > vw + 1,
    scrollWidth: document.documentElement.scrollWidth,
  }
}

const report = { pages: [], sweep: [] }

async function visit(route, width) {
  await page.setViewportSize({ width, height: width < 800 ? 800 : 900 })
  const errorsBefore = consoleErrors.length
  const failedBefore = failedRequests.length
  await page.goto(`${BASE}${route}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await sleep(800)
  const inv = await page.evaluate(inventoryScript)
  const entry = {
    route, width, finalUrl: page.url().replace(BASE, ''),
    elements: inv.items.length,
    unnamed: inv.items.filter((i) => !i.name).map((i) => `${i.tag}${i.role ? `[${i.role}]` : ''}`),
    offscreen: inv.items.filter((i) => i.offscreen).map((i) => i.name || i.tag),
    smallTargets: width === 375 ? inv.items.filter((i) => i.small).map((i) => i.name || i.tag) : [],
    hScroll: inv.hScroll, scrollWidth: inv.scrollWidth,
    consoleErrors: consoleErrors.slice(errorsBefore).map((e) => e.text),
    failedRequests: failedRequests.slice(failedBefore).map((f) => `${f.method} ${f.status} ${f.url}`),
    names: inv.items.map((i) => i.name),
  }
  report.pages.push(entry)
  return inv
}

async function sweep(route) {
  await page.setViewportSize({ width: SWEEP_WIDTH, height: 900 })
  await page.goto(`${BASE}${route}`)
  await page.waitForLoadState('networkidle').catch(() => {})
  await sleep(600)
  const buttons = page.locator('main button:visible, header button:visible, nav button:visible, [role="tab"]:visible, aside button:visible')
  const count = Math.min(await buttons.count(), 60)
  const names = []
  for (let i = 0; i < count; i += 1) names.push(((await buttons.nth(i).getAttribute('aria-label')) || (await buttons.nth(i).innerText().catch(() => '')) || '').trim().replace(/\s+/g, ' ').slice(0, 60))
  for (const name of names) {
    const row = { route, name, result: '' }
    if (!name) { row.result = 'skip: без имени'; report.sweep.push(row); continue }
    if (UNSAFE.test(name)) { row.result = 'skip: меняет данные'; report.sweep.push(row); continue }
    const errorsBefore = consoleErrors.length
    const failedBefore = failedRequests.length
    try {
      const target = page.getByRole('button', { name, exact: true }).first()
      if (!(await target.count())) { row.result = 'skip: не найдена повторно'; report.sweep.push(row); continue }
      if (await target.isDisabled()) { row.result = 'disabled'; report.sweep.push(row); continue }
      await target.click({ timeout: 3000 })
      await sleep(500)
      const dialog = await page.locator('[role="dialog"], [role="menu"], [role="listbox"]').count()
      const url = page.url().replace(BASE, '')
      const errs = consoleErrors.slice(errorsBefore).map((e) => e.text)
      const fails = failedRequests.slice(failedBefore).filter((f) => f.status >= 500 || f.status === 400).map((f) => `${f.method} ${f.status} ${f.url}`)
      row.result = errs.length || fails.length ? 'FAIL' : 'ok'
      row.effect = dialog ? 'открыл окно/меню' : (url !== route ? `переход ${url}` : 'без видимого перехода')
      if (errs.length) row.consoleErrors = errs
      if (fails.length) row.failed = fails
    } catch (error) {
      row.result = 'ERR'
      row.detail = String(error.message).split('\n')[0].slice(0, 160)
    }
    report.sweep.push(row)
    for (let k = 0; k < 3; k += 1) {
      if (!(await page.locator('[role="dialog"], [role="menu"], [role="listbox"]').count())) break
      await page.keyboard.press('Escape'); await sleep(200)
    }
    if (page.url().replace(BASE, '') !== route) {
      await page.goto(`${BASE}${route}`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await sleep(400)
    }
  }
}

try {
  for (const route of authRoutes) for (const width of WIDTHS) await visit(route, width)
  for (const route of authRoutes.filter((r) => !r.startsWith('/public') && r !== '/no-such-page')) await sweep(route)

  // Анонимные страницы — в отдельном контексте без сессии.
  const anon = await browser.newContext({ locale: 'ru-RU' })
  const anonPage = await anon.newPage()
  const anonErrors = []
  anonPage.on('console', (m) => { if (m.type() === 'error') anonErrors.push(m.text().slice(0, 200)) })
  for (const route of [...anonRoutes, `/public/document/${pub.public_id}`, `/documents/${doc.id}`]) {
    for (const width of WIDTHS) {
      await anonPage.setViewportSize({ width, height: 850 })
      const before = anonErrors.length
      await anonPage.goto(`${BASE}${route}`)
      await anonPage.waitForLoadState('networkidle').catch(() => {})
      await sleep(500)
      const inv = await anonPage.evaluate(inventoryScript)
      report.pages.push({
        route: `anon ${route}`, width, finalUrl: anonPage.url().replace(BASE, ''), elements: inv.items.length,
        unnamed: inv.items.filter((i) => !i.name).map((i) => i.tag),
        offscreen: inv.items.filter((i) => i.offscreen).map((i) => i.name || i.tag),
        smallTargets: [], hScroll: inv.hScroll, scrollWidth: inv.scrollWidth,
        consoleErrors: anonErrors.slice(before), failedRequests: [], names: inv.items.map((i) => i.name),
      })
    }
  }
  await anon.close()
} finally {
  await api('DELETE', `/documents/${doc.id}/publish/`)
  await api('DELETE', `/documents/${doc.id}/`)
  await api('DELETE', `/documents/${doc.id}/?permanent=true`)
  await api('DELETE', `/folders/${folder.id}/`)
  await browser.close()
}

writeFileSync('inventory-report.json', JSON.stringify(report, null, 1))

// --- Сводка ---
const unique = new Set(report.pages.filter((p) => p.width === SWEEP_WIDTH).flatMap((p) => p.names.map((n) => `${p.route}|${n}`)))
console.log(`Страниц×ширин: ${report.pages.length}; уникальных элементов на ${SWEEP_WIDTH}: ${unique.size}`)
const by = (k) => report.sweep.filter((s) => s.result.startsWith(k)).length
console.log(`Нажатий: ok ${by('ok')}, FAIL ${by('FAIL')}, ERR ${by('ERR')}, disabled ${by('disabled')}, пропущено ${by('skip')}`)
for (const p of report.pages) {
  const issues = []
  if (p.hScroll) issues.push(`гориз. прокрутка ${p.scrollWidth}px`)
  if (p.offscreen.length) issues.push(`за краем: ${p.offscreen.slice(0, 4).join(', ')}`)
  if (p.unnamed.length) issues.push(`без имени: ${p.unnamed.length}`)
  if (p.consoleErrors.length) issues.push(`console: ${p.consoleErrors[0].slice(0, 100)}`)
  const bad = p.failedRequests.filter((f) => !/ 401 /.test(f))
  if (bad.length) issues.push(`запросы: ${bad.slice(0, 2).join('; ')}`)
  if (issues.length) console.log(`${p.route} @${p.width}: ${issues.join(' | ')}`)
}
for (const s of report.sweep.filter((x) => x.result === 'FAIL' || x.result === 'ERR')) {
  console.log(`${s.result} ${s.route} «${s.name}» ${s.detail || ''} ${(s.consoleErrors || []).join(' ')} ${(s.failed || []).join(' ')}`.slice(0, 260))
}
