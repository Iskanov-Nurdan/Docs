/**
 * Десктоп, часть 2: офлайн и восстановление, меню, размер окна и его
 * сохранение, совместная правка с браузером. Только локальный docker (:8080).
 * Запуск: node desktop-extra.mjs
 */
import { _electron as electron, chromium } from 'playwright'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DESKTOP = path.resolve('..', 'desktop')
const BASE = 'http://localhost:8080'
const PROXY_PORT = 8099
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const out = (bug, name, detail = '') => console.log(`${bug ? 'BUG ' : 'ok  '} ${name}${detail ? ` — ${detail}` : ''}`)
const profile = mkdtempSync(path.join(os.tmpdir(), 'alitrade-qa-'))

function launch(url) {
  const env = { ...process.env, ALITRADE_URL: url }
  delete env.ELECTRON_RUN_AS_NODE
  return electron.launch({
    executablePath: path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: [DESKTOP, `--user-data-dir=${profile}`],
    env,
    timeout: 60000,
  })
}

// Прокси на :8099 → :8080: «сервер», который можно включить посреди проверки.
function startProxy() {
  const server = http.createServer((req, res) => {
    const upstream = http.request({ host: 'localhost', port: 8080, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:8080', ...(req.headers.origin ? { origin: BASE } : {}) } }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res)
    })
    upstream.on('error', () => { res.writeHead(502); res.end() })
    req.pipe(upstream)
  })
  server.on('upgrade', (req, socket, head) => {
    const upstream = http.request({ host: 'localhost', port: 8080, path: req.url, method: req.method, headers: { ...req.headers, host: 'localhost:8080', ...(req.headers.origin ? { origin: BASE } : {}) } })
    upstream.on('upgrade', (r, s, h) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`)
      if (h.length) socket.write(h)
      if (head.length) s.write(head)
      s.pipe(socket); socket.pipe(s)
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  })
  return new Promise((resolve) => server.listen(PROXY_PORT, () => resolve(server)))
}

async function login(page) {
  await page.waitForSelector('input[type="email"]', { timeout: 30000 })
  await page.fill('input[type="email"]', USER.email)
  await page.fill('input[type="password"]', USER.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 30000 })
}

let app
let browser
let proxy
let docId
let token
const apiCall = async (method, p, data) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}

try {
  // --- 1. Старт без сервера → своя страница «Нет связи», затем восстановление ---
  app = await launch(`http://localhost:${PROXY_PORT}/`)
  let page = await app.firstWindow()
  await sleep(4000)
  const offlineText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))
  const offline = page.url().startsWith('file:') && /Повторить/.test(offlineText)
  out(!offline, 'Без сервера — своя страница с «Повторить»', `${page.url().slice(0, 60)} | ${offlineText.slice(0, 80)}`)

  proxy = await startProxy()
  if (offline) await page.getByRole('button', { name: 'Повторить' }).click()
  await sleep(4000)
  out(!/\/login/.test(page.url()), 'Сервер появился → «Повторить» открывает приложение', page.url())
  await login(page)
  out(false, 'Вход в десктопе через восстановившийся сервер')

  // --- 2. Меню и масштаб ---
  const menu = await app.evaluate(({ Menu }) => (Menu.getApplicationMenu()?.items ?? []).map((i) => ({ label: i.label, sub: (i.submenu?.items ?? []).map((s) => s.label).filter(Boolean) })))
  out(menu.length === 0, 'Меню приложения', menu.map((m) => `${m.label}[${m.sub.join(', ')}]`).join(' '))
  const zoom = await app.evaluate(({ BrowserWindow, Menu }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const find = (role) => Menu.getApplicationMenu().items.flatMap((i) => i.submenu?.items ?? []).find((s) => s.role?.toLowerCase() === role.toLowerCase())
    find('zoomIn').click(undefined, win, win.webContents)
    const zoomed = win.webContents.getZoomLevel()
    find('resetZoom').click(undefined, win, win.webContents)
    return { zoomed, reset: win.webContents.getZoomLevel() }
  })
  out(!(zoom.zoomed > 0 && zoom.reset === 0), 'Меню «Крупнее» и «Обычный размер» меняют масштаб', JSON.stringify(zoom))

  // --- 3. Размер окна: минимум, раскладка, сохранение между запусками ---
  for (const [w, h] of [[360, 480], [800, 600], [1366, 768], [1920, 1040]]) {
    await app.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows()[0]; win.unmaximize(); win.setSize(size[0], size[1]) }, [w, h])
    await sleep(700)
    const layout = await page.evaluate(() => ({ vw: window.innerWidth, sw: document.documentElement.scrollWidth }))
    out(layout.sw > layout.vw + 1, `Окно ${w}×${h}: без горизонтальной прокрутки`, `viewport ${layout.vw}, scroll ${layout.sw}`)
  }
  const tooSmall = await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setSize(200, 200); return win.getSize() })
  out(tooSmall[0] < 360 || tooSmall[1] < 480, 'Окно не сжимается меньше минимума 360×480', tooSmall.join('×'))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setBounds({ x: 120, y: 90, width: 1111, height: 777 }) })
  await sleep(500)

  // --- 4. Совместная правка: десктоп ↔ браузер ---
  token = await page.evaluate(() => localStorage.getItem('docs.access'))
  docId = (await apiCall('POST', '/documents/', { title: 'DESKTOP синхронизация' })).body.id
  await page.goto(`http://localhost:${PROXY_PORT}/documents/${docId}`, { waitUntil: 'domcontentloaded' })
  const grid = page.locator('[role="grid"]')
  await grid.waitFor({ timeout: 30000 }); await sleep(1500)

  browser = await chromium.launch()
  const web = await (await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'ru-RU' })).newPage()
  await web.goto(`${BASE}/login`)
  await web.fill('input[type="email"]', USER.email); await web.fill('input[type="password"]', USER.password)
  await web.click('button[type="submit"]'); await web.waitForURL(/\/documents/)
  await web.goto(`${BASE}/documents/${docId}`)
  const webGrid = web.locator('[role="grid"]')
  await webGrid.waitFor(); await sleep(1500)

  const cellsOf = (p) => p.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).map((n) => n.textContent.trim()).filter(Boolean))
  await grid.click({ position: { x: 230, y: 36 } }); await page.keyboard.type('FROMDESKTOP'); await page.keyboard.press('Enter')
  let seen = false
  for (let i = 0; i < 20 && !seen; i += 1) { await sleep(500); seen = (await cellsOf(web)).includes('FROMDESKTOP') }
  out(!seen, 'Правка в десктопе появляется в браузере без перезагрузки')

  await webGrid.click({ position: { x: 230, y: 60 } }); await web.keyboard.type('FROMWEB'); await web.keyboard.press('Enter')
  seen = false
  for (let i = 0; i < 20 && !seen; i += 1) { await sleep(500); seen = (await cellsOf(page)).includes('FROMWEB') }
  out(!seen, 'Правка в браузере появляется в десктопе без перезагрузки')

  // --- 5. Закрытие и повторный запуск: сессия и размер окна сохраняются ---
  await sleep(2500) // дать снимку уйти на сервер
  await app.close(); app = null
  app = await launch(`http://localhost:${PROXY_PORT}/`)
  page = await app.firstWindow()
  await sleep(5000)
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  out(Math.abs(bounds.width - 1111) > 2 || Math.abs(bounds.height - 777) > 2, 'Размер окна восстановлен после перезапуска', JSON.stringify(bounds))
  out(/\/login/.test(page.url()), 'Сессия сохранена после перезапуска', page.url())

  // Данные в базе: обе правки сохранились
  await sleep(1000)
  const saved = JSON.stringify((await apiCall('GET', `/documents/${docId}/`)).body?.content ?? {})
  out(!(saved.includes('FROMDESKTOP') && saved.includes('FROMWEB')), 'Обе правки сохранены на сервере', saved.slice(0, 120))
} catch (error) {
  out(true, 'Сценарий прервался', String(error.message).split('\n')[0].slice(0, 200))
} finally {
  if (docId && token) { await apiCall('DELETE', `/documents/${docId}/`); await apiCall('DELETE', `/documents/${docId}/?permanent=true`) }
  if (app) await app.close().catch(() => {})
  if (browser) await browser.close().catch(() => {})
  if (proxy) proxy.close()
  rmSync(profile, { recursive: true, force: true })
}
