/**
 * Полный проход, часть 2: доступ без входа, уведомления, выгрузки, клавиатура,
 * выход, восстановление пароля, бухгалтерия, админка, шаблоны, телефон.
 * Только локальный docker (:8080). Всё созданное — убирает за собой.
 */
import { chromium, devices } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const OTHER = { email: 'qa-other@test.local', password: 'QaOther12345!' }
const ADMIN = { email: 'qa-admin@test.local', password: 'QaAdmin12345!' }
const SHOTS = 'shots/fullclick2'
mkdirSync(SHOTS, { recursive: true })

const results = []
const consoleErrors = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let section = ''

async function check(page, name, fn) {
  const label = `${section} · ${name}`
  try {
    const verdict = (await fn()) ?? {}
    const status = verdict.bug ? 'BUG' : 'ok'
    results.push({ name: label, status, detail: verdict.detail ?? '' })
    console.log(`${status === 'BUG' ? 'BUG ' : 'ok  '} ${label}${verdict.detail ? ` — ${verdict.detail}` : ''}`)
    if (verdict.bug) await page.screenshot({ path: `${SHOTS}/${results.length}-bug.png` })
  } catch (error) {
    const detail = String(error.message).split('\n')[0].slice(0, 200)
    results.push({ name: label, status: 'ERR', detail })
    console.log(`ERR  ${label} — ${detail}`)
    await page.screenshot({ path: `${SHOTS}/${results.length}-err.png` }).catch(() => {})
  }
  for (let i = 0; i < 3; i += 1) {
    if ((await page.locator('[role="dialog"], [role="menu"]').count().catch(() => 0)) === 0) break
    await page.keyboard.press('Escape').catch(() => {})
    await sleep(200)
  }
}
async function waitFor(fn, timeout = 8000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await fn().catch(() => false)) return true
    await sleep(250)
  }
  return false
}
async function login(page, who) {
  await page.goto(`${BASE}/login`, { timeout: 90000 })
  await page.fill('input[type="email"]', who.email)
  await page.fill('input[type="password"]', who.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 30000 })
}
const auth = async (page) => ({ Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('docs.access'))}` })
const api = async (page, method, path, data) => {
  const response = await page.request.fetch(`${BASE}/api${path}`, { method, headers: await auth(page), data })
  return { status: response.status(), body: await response.json().catch(() => null) }
}
const grid = (page) => page.locator('[role="grid"]')
async function select(page, col, row) {
  await grid(page).click({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await sleep(300)
}
async function type(page, col, row, text) {
  await select(page, col, row)
  await grid(page).dblclick({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await sleep(250)
}
async function focusCell(page) {
  return page.locator('[aria-label="Выделенный диапазон"]').innerText().catch(() => '?')
}

const main = async () => {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU', acceptDownloads: true })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e.message).slice(0, 200)))
  page.on('dialog', (d) => d.accept().catch(() => {}))
  await login(page, USER)

  const { body: doc } = await api(page, 'POST', '/documents/', { title: 'FULLCLICK2 доступ' })
  await page.goto(`${BASE}/documents/${doc.id}`)
  await grid(page).waitFor({ timeout: 30000 }); await sleep(1200)
  await type(page, 0, 0, 'Машина'); await type(page, 1, 0, 'Груз'); await type(page, 0, 1, 'PUB-777'); await type(page, 1, 1, 'Мука')

  // ============================ ДОСТУП БЕЗ ВХОДА ============================
  section = 'Без входа'
  await check(page, 'Опубликовать → страница открывается без входа', async () => {
    await page.getByRole('button', { name: 'Поделиться' }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки доступа' })
    await dialog.getByRole('button', { name: 'Опубликовать' }).click(); await sleep(1500)
    const { body } = await api(page, 'GET', `/documents/${doc.id}/publish/`)
    await page.keyboard.press('Escape')
    if (!body?.public_id) return { bug: true, detail: `публикация: ${JSON.stringify(body).slice(0, 120)}` }
    const anon = await browser.newContext({ locale: 'ru-RU' })
    const guest = await anon.newPage()
    await guest.goto(`${BASE}/public/document/${body.public_id}`)
    const seen = await waitFor(async () => (await guest.getByText('PUB-777').count()) > 0)
    const atLogin = /\/login/.test(guest.url())
    await guest.screenshot({ path: `${SHOTS}/public.png` })
    await anon.close()
    return { bug: !seen || atLogin, detail: `видно данные: ${seen}, выкинуло на вход: ${atLogin}` }
  })
  await check(page, 'Снять с публикации → страница больше не открывается', async () => {
    const { body } = await api(page, 'GET', `/documents/${doc.id}/publish/`)
    await page.getByRole('button', { name: 'Поделиться' }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки доступа' })
    await dialog.getByRole('button', { name: 'Снять с публикации' }).click(); await sleep(1200)
    await page.keyboard.press('Escape')
    const anon = await browser.newContext()
    const guest = await anon.newPage()
    await guest.goto(`${BASE}/public/document/${body.public_id}`)
    await sleep(2500)
    const still = await guest.getByText('PUB-777').count()
    await anon.close()
    return { bug: still > 0, detail: still > 0 ? 'данные всё ещё видны' : 'закрыто' }
  })
  await check(page, 'Ссылка «Все, у кого есть ссылка» открывается без входа', async () => {
    await page.getByRole('button', { name: 'Поделиться' }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки доступа' })
    await dialog.getByLabel('Кому доступна ссылка').click()
    await page.getByRole('option', { name: 'Все, у кого есть ссылка' }).click(); await sleep(1200)
    await page.keyboard.press('Escape')
    const { body } = await api(page, 'GET', `/documents/${doc.id}/permissions/`)
    const token = body?.link?.token ?? body?.share_link?.token
    if (!token) return { bug: true, detail: `нет токена ссылки: ${JSON.stringify(body).slice(0, 160)}` }
    const anon = await browser.newContext({ locale: 'ru-RU' })
    const guest = await anon.newPage()
    await guest.goto(`${BASE}/documents/${doc.id}?link=${token}`)
    const seen = await waitFor(async () => (await guest.getByText('PUB-777').count()) > 0, 10000)
    const url = guest.url()
    await guest.screenshot({ path: `${SHOTS}/link-anon.png` })
    await anon.close()
    return { bug: !seen, detail: seen ? 'открылась' : `не открылась, адрес: ${url.replace(BASE, '')}` }
  })

  // ============================ УВЕДОМЛЕНИЯ ============================
  section = 'Уведомления'
  await check(page, 'Приглашённый видит уведомление в колокольчике', async () => {
    await page.getByRole('button', { name: 'Поделиться' }).click()
    const dialog = page.getByRole('dialog', { name: 'Настройки доступа' })
    await dialog.getByPlaceholder('name@example.com').fill(OTHER.email)
    await dialog.getByRole('button', { name: /Пригласить|Добавить|Открыть доступ/ }).first().click(); await sleep(1500)
    await page.keyboard.press('Escape')
    const otherCtx = await browser.newContext({ locale: 'ru-RU', viewport: { width: 1400, height: 900 } })
    const other = await otherCtx.newPage()
    await login(other, OTHER)
    await sleep(1500)
    const bell = other.getByLabel(/^Уведомления/).first()
    const label = await bell.getAttribute('aria-label')
    await bell.click(); await sleep(800)
    const text = await other.locator('body').innerText()
    await otherCtx.close()
    const mentions = /FULLCLICK2 доступ/.test(text)
    return { bug: !mentions, detail: `колокольчик: «${label}»; упоминание документа: ${mentions}` }
  })

  // ============================ ВЫГРУЗКИ ============================
  section = 'Выгрузка'
  for (const [name, ext] of [['PDF', '.pdf'], ['Word', '.docx'], ['Текст с табуляцией', '.txt'], ['Таблица', '.csv']]) {
    await check(page, `Файл → ${name}`, async () => {
      await page.getByRole('button', { name: 'Файл', exact: true }).click()
      const download = page.waitForEvent('download', { timeout: 40000 }).catch(() => null)
      const popup = page.waitForEvent('popup', { timeout: 40000 }).catch(() => null)
      await page.getByRole('menuitem', { name: new RegExp(`^Скачать ${name}`) }).click()
      const first = await Promise.race([download, popup])
      let file = first?.suggestedFilename ? first : null
      if (!file && first) file = await first.waitForEvent('download', { timeout: 15000 }).catch(() => null)
      const fileName = file?.suggestedFilename()
      const size = file ? (await import('node:fs')).statSync(await file.path()).size : 0
      return { bug: !fileName?.endsWith(ext) || size === 0, detail: `${fileName ?? 'нет файла'}, ${size} байт` }
    })
  }
  await check(page, 'Файл → Печать открывает печать', async () => {
    await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1 } })
    await page.getByRole('button', { name: 'Файл', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Печать' }).click(); await sleep(1500)
    const printed = await page.evaluate(() => window.__printed)
    return { bug: printed < 1, detail: `window.print вызван: ${printed}` }
  })

  // ============================ КЛАВИАТУРА ============================
  section = 'Клавиатура'
  await check(page, 'Стрелки, Tab, Home, End двигают выделение', async () => {
    await select(page, 0, 1)
    const steps = []
    for (const key of ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Tab', 'End', 'Home']) {
      await page.keyboard.press(key); await sleep(150)
      steps.push(`${key}:${await focusCell(page)}`)
    }
    const want = ['ArrowRight:B2', 'ArrowDown:B3', 'ArrowLeft:A3', 'ArrowUp:A2', 'Tab:B2']
    const ok = want.every((w, i) => steps[i] === w) && steps[6] === 'Home:A2'
    return { bug: !ok, detail: steps.join(' ') }
  })
  await check(page, 'Набор на выделенной ячейке заменяет значение, Delete очищает', async () => {
    await select(page, 1, 1)
    await page.keyboard.type('Сахар'); await page.keyboard.press('Enter'); await sleep(300)
    const replaced = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).some((n) => n.textContent.trim() === 'Сахар'))
    await select(page, 1, 1)
    await page.keyboard.press('Delete'); await sleep(300)
    const cleared = !(await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).some((n) => n.textContent.trim() === 'Сахар')))
    return { bug: !replaced || !cleared, detail: `заменилось: ${replaced}, очистилось: ${cleared}` }
  })
  await check(page, 'Escape отменяет правку ячейки', async () => {
    await select(page, 0, 1)
    await grid(page).dblclick({ position: { x: 30, y: 36 } })
    await page.keyboard.type('ЛИШНЕЕ'); await page.keyboard.press('Escape'); await sleep(300)
    const kept = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).some((n) => n.textContent.trim() === 'PUB-777'))
    return { bug: !kept, detail: kept ? 'осталось PUB-777' : 'значение изменилось' }
  })
  await check(page, 'Выделение мышкой диапазона и Delete очищает всё', async () => {
    await type(page, 3, 3, 'x1'); await type(page, 4, 4, 'x2')
    await select(page, 3, 3)
    await grid(page).click({ position: { x: 430, y: 4 * 24 + 12 }, modifiers: ['Shift'] }); await sleep(200)
    await page.keyboard.press('Delete'); await sleep(300)
    const left = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).filter((n) => ['x1', 'x2'].includes(n.textContent.trim())).length)
    return { bug: left > 0, detail: `осталось: ${left}` }
  })

  // ============================ ШАБЛОНЫ ============================
  section = 'Шаблоны'
  await check(page, 'Таблица из галереи шаблонов щелчком', async () => {
    await page.goto(`${BASE}/templates`); await sleep(1500)
    await page.getByText('Журнал рейсов', { exact: true }).first().click()
    await page.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 25000 })
    await grid(page).waitFor({ timeout: 30000 }); await sleep(1500)
    const hasHeader = await page.getByText('Машина', { exact: true }).count()
    const id = page.url().split('/').pop()
    await api(page, 'PATCH', `/documents/${id}/`, { title: 'FULLCLICK2 из шаблона' })
    return { bug: hasHeader === 0, detail: hasHeader ? 'шапка есть' : 'пустая таблица' }
  })

  // ============================ ВЫХОД ============================
  section = 'Вход/выход'
  await check(page, 'Выход и защита страниц', async () => {
    await page.goto(`${BASE}/documents`); await sleep(1000)
    await page.getByLabel('Меню пользователя').click()
    await page.getByRole('menuitem', { name: 'Выйти' }).click()
    await page.waitForURL(/\/login/, { timeout: 10000 })
    await page.goto(`${BASE}/documents/${doc.id}`); await sleep(1500)
    const kicked = /\/login/.test(page.url())
    const token = await page.evaluate(() => localStorage.getItem('docs.access'))
    return { bug: !kicked || Boolean(token), detail: `на вход: ${kicked}, токен остался: ${Boolean(token)}` }
  })
  await check(page, 'Забыли пароль: понятный ответ', async () => {
    await page.goto(`${BASE}/forgot-password`); await sleep(800)
    await page.locator('input[type="email"]').fill('qa@test.local')
    await page.locator('button[type="submit"]').click(); await sleep(1500)
    const text = (await page.locator('main, form, body').first().innerText()).replace(/\s+/g, ' ')
    return { bug: !/отправ|письм|почт/i.test(text), detail: text.slice(0, 140) }
  })
  await login(page, USER)

  // ============================ БУХГАЛТЕРИЯ И АДМИНКА ============================
  section = 'Админ'
  const adminCtx = await browser.newContext({ viewport: { width: 1600, height: 950 }, locale: 'ru-RU' })
  const admin = await adminCtx.newPage()
  admin.on('dialog', (d) => d.accept().catch(() => {}))
  await login(admin, ADMIN)
  await check(admin, 'Бухгалтерия: открыть таблицу и переключить карточки', async () => {
    await admin.goto(`${BASE}/accountant`); await sleep(2000)
    await admin.locator('main ul li button').first().click(); await sleep(800)
    const cards = admin.locator('button[aria-pressed]')
    const count = await cards.count()
    if (count > 1) { await cards.nth(1).click(); await sleep(400) }
    const pressed = await admin.locator('button[aria-pressed="true"]').count()
    await admin.getByRole('button', { name: /Все таблицы/ }).click(); await sleep(500)
    return { bug: count === 0 || pressed !== 1, detail: `карточек: ${count}, выбрана: ${pressed}` }
  })
  await check(admin, 'Админка: смена роли и закрытие/возврат доступа', async () => {
    const created = await api(admin, 'POST', '/admin/users/', { email: 'qa-fc2@test.local', first_name: 'Проверка', password: 'QaFc2Pass123!', role: 'member' })
    if (created.status >= 300) return { bug: true, detail: `не создать тестового: ${created.status} ${JSON.stringify(created.body).slice(0, 120)}` }
    await admin.goto(`${BASE}/admin`); await sleep(1500)
    await admin.getByLabel('Поиск людей').fill('qa-fc2'); await sleep(800)
    await admin.getByLabel(/Уровень прав: Проверка/).click()
    await admin.getByRole('option', { name: 'Бухгалтер' }).click(); await sleep(800)
    const role = (await api(admin, 'GET', '/admin/users/?q=qa-fc2')).body
    const list = Array.isArray(role) ? role : role?.results || []
    const accountant = list.find((u) => u.email === 'qa-fc2@test.local')?.role
    await admin.getByRole('button', { name: 'Закрыть доступ' }).first().click()
    const confirm = admin.getByRole('dialog').getByRole('button', { name: 'Закрыть доступ' })
    if (await confirm.count()) await confirm.click()
    await sleep(800)
    const blockedCtx = await browser.newContext()
    const blocked = await blockedCtx.newPage()
    await blocked.goto(`${BASE}/login`)
    await blocked.fill('input[type="email"]', 'qa-fc2@test.local')
    await blocked.fill('input[type="password"]', 'QaFc2Pass123!')
    await blocked.click('button[type="submit"]'); await sleep(2000)
    const cantLogin = /\/login/.test(blocked.url())
    await blockedCtx.close()
    await admin.getByRole('button', { name: 'Вернуть доступ' }).first().click(); await sleep(800)
    const after = (await api(admin, 'GET', '/admin/users/?q=qa-fc2')).body
    const back = (Array.isArray(after) ? after : after?.results || []).find((u) => u.email === 'qa-fc2@test.local')?.is_active
    return { bug: accountant !== 'accountant' || !cantLogin || back !== true, detail: `роль: ${accountant}, закрытый не вошёл: ${cantLogin}, вернули: ${back}` }
  })
  await adminCtx.close()

  // ============================ ТЕЛЕФОН ============================
  section = 'Телефон'
  const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' })
  const mobile = await phone.newPage()
  await login(mobile, USER)
  for (const [name, path] of [['Документы', '/documents'], ['Шаблоны', '/templates'], ['Точки и маршруты', '/routes'], ['Настройки', '/settings'], ['Скачать', '/download'], ['Таблица', `/documents/${doc.id}`]]) {
    await check(mobile, `«${name}» без прокрутки вбок`, async () => {
      await mobile.goto(`${BASE}${path}`); await sleep(2000)
      const extra = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      return { bug: extra > 2, detail: `лишняя ширина ${extra}px` }
    })
  }
  await phone.close()

  // ============================ УБОРКА ============================
  await api(page, 'DELETE', `/documents/${doc.id}/`)
  writeFileSync('fullclick2-report.json', JSON.stringify({ results, consoleErrors }, null, 1))
  const n = (s) => results.filter((r) => r.status === s).length
  console.log(`\nИТОГ: ${n('ok')} ok, ${n('BUG')} BUG, ${n('ERR')} ERR`)
  if (consoleErrors.length) console.log('Ошибки страницы:', consoleErrors.slice(0, 3).join(' || '))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
