/**
 * Проверки, которые не укладываются в обычный сценарий: длинные списки,
 * заглушки на время загрузки, потеря связи и работа на телефоне.
 */
import { chromium, devices } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:8080'
const USER = { email: 'qa@test.local', password: 'QaTest12345!' }
const here = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const SHOTS = `${here}shots`

const results = []
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function step(page, name, fn) {
  try {
    await fn()
    results.push({ name, status: 'PASS' })
    console.log(`  PASS  ${name}`)
  } catch (error) {
    const file = `${SHOTS}/extra-${name.replace(/[^\w]+/g, '-').slice(0, 30)}.png`
    await page?.screenshot({ path: file }).catch(() => {})
    results.push({ name, status: 'FAIL', error: String(error.message).split('\n')[0], shot: file })
    console.log(`  FAIL  ${name}\n        ${String(error.message).split('\n')[0]}`)
  }
}

async function waitFor(check, { timeout = 10000, message = 'не дождались' } = {}) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    if (await check().catch(() => false)) return true
    await sleep(200)
  }
  throw new Error(message)
}

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.fill('input[type="email"]', USER.email)
  await page.fill('input[type="password"]', USER.password)
  await page.click('button[type="submit"]')
  await page.waitForURL(/\/documents/, { timeout: 20000 })
}

const main = async () => {
  const browser = await chromium.launch()

  // ------------------------- Длинный список -------------------------
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ru-RU' })
  const page = await context.newPage()
  await login(page)

  const token = await page.evaluate(() => localStorage.getItem('docs.access'))
  const headers = { Authorization: `Bearer ${token}` }

  await step(page, 'Список из 70 таблиц листается', async () => {
    // Заводим заведомо больше, чем помещается на страницу выдачи.
    for (let index = 0; index < 70; index += 1) {
      await page.request.post(`${BASE}/api/documents/`, {
        headers, data: { title: `Много ${String(index).padStart(2, '0')}` },
      })
    }
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.locator('li').filter({ hasText: /^Лист1Много/ }).count()) > 10,
      { message: 'список не загрузился' })

    const first = await page.locator('li').filter({ hasText: /Много/ }).count()
    // Прокручиваем вниз: список должен дозагрузиться или показать листание.
    await page.mouse.wheel(0, 20000)
    await sleep(1500)
    await page.mouse.wheel(0, 20000)
    await waitFor(async () => {
      const now = await page.locator('li').filter({ hasText: /Много/ }).count()
      const more = await page.getByRole('button', { name: /Показать ещё|Ещё|Далее/ }).count()
      return now > first || more > 0
    }, { message: `список не листается: как было ${first} карточек, так и осталось` })
  })

  await step(page, 'Заглушки на время загрузки', async () => {
    // Задерживаем ответ, чтобы застать состояние загрузки.
    await page.route('**/api/documents/**', async (route) => {
      await sleep(1200)
      await route.continue()
    })
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.locator('.skeleton').count()) > 0,
      { timeout: 4000, message: 'на время загрузки нет ни заглушек, ни признака ожидания' })
    await page.unroute('**/api/documents/**')
  })

  await step(page, 'Потеря связи: приложение сообщает, а не молчит', async () => {
    await page.goto(`${BASE}/documents`, { waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.locator('li').count()) > 0, { message: 'список не открылся' })
    await context.setOffline(true)
    await page.getByLabel('Поиск документов').fill('Много 01')
    await sleep(2500)
    const text = await page.locator('body').innerText()
    assert(/не удалось|нет связи|ошибка|повторить/i.test(text),
      'при обрыве связи приложение ничего не сообщило')
    await context.setOffline(false)
  })

  await step(page, 'Восстановление связи: список снова грузится', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitFor(async () => (await page.locator('li').filter({ hasText: /Много/ }).count()) > 0,
      { message: 'после возврата связи список не загрузился' })
  })

  // Убираем за собой.
  const response = await page.request.get(`${BASE}/api/documents/?scope=active&page_size=100`, { headers })
  for (const item of (await response.json()).results || []) {
    await page.request.delete(`${BASE}/api/documents/${item.id}/?permanent=true`, { headers })
  }
  await context.close()

  // ---------------------------- Телефон ----------------------------
  const phone = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' })
  const mobile = await phone.newPage()
  await login(mobile)

  await step(mobile, 'Телефон: список открывается, меню прячется в кнопку', async () => {
    await waitFor(async () => (await mobile.getByRole('heading', { name: 'Мои документы' }).count()) > 0,
      { message: 'на телефоне не открылся список' })
    assert(await mobile.getByLabel('Открыть меню').isVisible(), 'нет кнопки меню на телефоне')
    await mobile.getByLabel('Открыть меню').click()
    await waitFor(async () => (await mobile.getByRole('dialog', { name: 'Разделы' }).count()) > 0,
      { message: 'боковая панель не открылась' })
    await mobile.keyboard.press('Escape')
    await waitFor(async () => (await mobile.getByRole('dialog', { name: 'Разделы' }).count()) === 0,
      { message: 'панель разделов не закрылась по Escape' })
  })

  await step(mobile, 'Телефон: страница не едет вбок', async () => {
    const overflow = await mobile.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert(overflow <= 2, `страница шире экрана на ${overflow} пикселей`)
  })

  await step(mobile, 'Телефон: таблица открывается, панель в одну строку', async () => {
    await mobile.getByRole('button', { name: 'Создать таблицу' }).click()
    await mobile.waitForURL(/\/documents\/[0-9a-f-]{36}/, { timeout: 25000 })
    await waitFor(async () => (await mobile.locator('[role="grid"]').count()) > 0,
      { message: 'сетка не открылась на телефоне' })

    const toolbar = await mobile.evaluate(() => {
      const node = document.querySelector('[role="toolbar"]')
      return node ? { height: node.getBoundingClientRect().height, scroll: node.scrollWidth > node.clientWidth } : null
    })
    assert(toolbar, 'панель инструментов не найдена')
    // Одна строка кнопок — около 48 пикселей; перенос дал бы кратно больше.
    assert(toolbar.height < 80, `панель заняла ${Math.round(toolbar.height)} пикселей вместо одной строки`)
    assert(toolbar.scroll, 'панель не прокручивается вбок — кнопки будут недоступны')
  })

  await step(mobile, 'Телефон: окно открывается снизу и закрывается', async () => {
    await mobile.getByTitle('Добавить запись формой').click()
    await waitFor(async () => (await mobile.getByRole('dialog').count()) > 0,
      { message: 'окно не открылось' })
    const box = await mobile.getByRole('dialog').boundingBox()
    const size = mobile.viewportSize()
    assert(box.width <= size.width + 2, 'окно шире экрана')
    await mobile.keyboard.press('Escape')
    await waitFor(async () => (await mobile.getByRole('dialog').count()) === 0,
      { message: 'окно не закрылось' })
  })

  await mobile.screenshot({ path: `${SHOTS}/extra-mobile-editor.png` })
  await phone.close()

  const passed = results.filter((item) => item.status === 'PASS').length
  console.log(`\n===== ДОПОЛНИТЕЛЬНО: ${passed} PASS, ${results.length - passed} FAIL =====`)
  writeFileSync(`${here}report-extra.json`, JSON.stringify(results, null, 2))
  await browser.close()
}

main().catch((error) => {
  console.error('ПРОГОН УПАЛ:', error)
  process.exit(1)
})
