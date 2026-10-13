/**
 * Проверка десктоп-приложения (desktop/main.js) на локальном сервере.
 * Запуск: node desktop-check.mjs  (нужен docker на :8080 и qa@test.local)
 */
import { _electron as electron } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const DESKTOP = path.resolve('..', 'desktop')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
mkdirSync('shots/desktop', { recursive: true })
const out = (bug, name, detail = '') => console.log(`${bug ? 'BUG ' : 'ok  '} ${name}${detail ? ` — ${detail}` : ''}`)

const env = { ...process.env, ALITRADE_URL: 'http://localhost:8080/' }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: path.join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe'),
  args: [DESKTOP, `--user-data-dir=${path.resolve('shots', 'desktop', 'profile')}`],
  env,
  timeout: 60000,
})
const page = await app.firstWindow()
await page.waitForLoadState('domcontentloaded')

try {
  // --- Вход ---
  await page.waitForSelector('input[type="email"]', { timeout: 60000 })
  await page.fill('input[type="email"]', 'qa@test.local')
  await page.fill('input[type="password"]', 'QaTest12345!')
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 30000 })
  out(false, 'Вход в приложении')

  const title = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getTitle())
  out(!title, 'Окно с заголовком', title)

  // --- Раздел «Скачать» внутри приложения ---
  await page.getByRole('link', { name: 'Скачать' }).first().click()
  await page.waitForURL(/\/download/)
  const inside = await page.getByText('Вы уже в приложении').count()
  out(inside === 0, 'Страница «Скачать» понимает, что открыта в приложении')

  // --- Таблица: поиск по номеру на другом листе ---
  const headers = { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('docs.access'))}` }
  const doc = await (await page.request.post('http://localhost:8080/api/documents/', {
    headers, data: { title: 'DESKTOP проверка', template_id: undefined },
  })).json()
  await page.goto(`http://localhost:8080/documents/${doc.id}`)
  const grid = page.locator('[role="grid"]')
  await grid.waitFor({ timeout: 30000 })
  await sleep(1200)
  const type = async (col, row, text) => {
    await grid.click({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
    await sleep(300)
    await grid.dblclick({ position: { x: col * 100 + 30, y: row * 24 + 12 } })
    await page.keyboard.type(text)
    await page.keyboard.press('Enter')
    await sleep(200)
  }
  await type(0, 0, 'Машина'); await type(1, 0, 'Груз'); await type(0, 1, 'АJ8722'); await type(1, 1, 'Цемент')

  // Ctrl+F в приложении — поиск таблицы, а не системный
  await page.keyboard.press('Control+f')
  const opened = await page.getByLabel('Что искать').waitFor({ timeout: 4000 }).then(() => true).catch(() => false)
  out(!opened, 'Ctrl+F открывает поиск таблицы')
  if (opened) {
    await page.getByLabel('Что искать').fill('aj 8722')
    await sleep(700)
    const found = await page.locator('[role="status"]').filter({ hasText: / из / }).count()
    out(found === 0, 'Поиск номера с русской «А» и пробелом')
    await page.keyboard.press('Escape')
  }

  // Ctrl+Z работает в приложении (меню его не перехватывает)
  await type(1, 2, 'отмена')
  await grid.click({ position: { x: 30, y: 8 * 24 + 12 } })
  await page.keyboard.press('Control+z')
  await sleep(500)
  const undone = await page.evaluate(() => Array.from(document.querySelectorAll('[role="gridcell"]')).some((n) => n.textContent.trim() === 'отмена'))
  out(undone, 'Ctrl+Z отменяет правку в приложении')

  // --- Выгрузка: файл скачивается, лишних пустых окон не остаётся ---
  const downloads = []
  await app.evaluate(({ session }, dir) => {
    session.defaultSession.on('will-download', (_event, item) => {
      item.setSavePath(dir + String.fromCharCode(92) + item.getFilename())
      console.log('[main] will-download', item.getURL(), item.getFilename())
    })
  }, path.resolve('shots', 'desktop'))
  app.on('window', (win) => downloads.push(win.url()))
  app.process().stdout.on('data', (d) => process.stdout.write('[main-out] ' + d))
  await app.evaluate(({ app: electronApp }) => {
    electronApp.on('web-contents-created', (_e, wc) => {
      const tag = 'wc' + wc.id
      wc.on('did-start-navigation', (d) => console.log(tag, 'nav', d.url, 'main', d.isMainFrame))
      wc.on('did-fail-load', (_e2, code, desc, url) => console.log(tag, 'fail', code, desc, url))
      wc.on('did-finish-load', () => console.log(tag, 'finish', wc.getURL()))
      wc.on('will-navigate', (_e3, url) => console.log(tag, 'will-navigate', url))
      wc.on('will-redirect', (_e4, url) => console.log(tag, 'will-redirect', url))
    })
  })
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  await page.getByRole('button', { name: 'Файл', exact: true }).click()
  const csv = page.getByRole('menuitem', { name: /.csv/i })
  if (await csv.count()) {
    await csv.first().click()
    await sleep(15000)
    const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ url: w.webContents.getURL(), visible: w.isVisible() })))
    const saved = (await import('node:fs')).readdirSync(path.resolve('shots', 'desktop')).filter((f) => f.endsWith('.csv'))
    out(saved.length === 0, 'Выгрузка CSV сохраняется на диск', saved.join(', '))
    const stray = windows.length - before
    out(stray > 0, 'После скачивания не остаётся пустого окна', `окон было ${before}, стало ${windows.length}: ${JSON.stringify(windows.map((w) => w.url.slice(0, 60)))}`)
  } else {
    out(true, 'Меню «Файл» → CSV', 'пункта CSV нет')
  }

  await page.screenshot({ path: 'shots/desktop/editor.png' })
  await page.request.delete(`http://localhost:8080/api/documents/${doc.id}/`, { headers })
} catch (error) {
  out(true, 'Сценарий прервался', String(error.message).split('\n')[0])
  await page.screenshot({ path: 'shots/desktop/error.png' }).catch(() => {})
} finally {
  await app.close().catch(() => {})
}
