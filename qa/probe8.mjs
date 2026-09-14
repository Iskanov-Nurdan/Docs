import { chromium } from 'playwright'
const BASE='http://localhost:8080'
const b = await chromium.launch(); const page = await b.newPage({ viewport:{width:1400,height:900} })
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]','qa@test.local'); await page.fill('input[type="password"]','QaTest12345!')
await page.click('button[type="submit"]'); await page.waitForURL(/\/documents/)
await page.getByRole('button', { name:'Создать таблицу' }).click()
await page.waitForURL(/\/documents\/[0-9a-f-]{36}/); const url=page.url(); const id=url.split('/').pop()
await page.waitForTimeout(2000)

// Повторяем ровно ту последовательность, что делает тест.
const type = async (x,y,t) => { await page.locator('[role="grid"]').dblclick({position:{x,y}}); await page.keyboard.type(t); await page.keyboard.press('Enter') }
await type(60,20,'Машина'); await type(60,44,'01KG777AAA')
await page.locator('[role="grid"]').click({position:{x:360,y:20}}); await page.keyboard.type('AUTO-1'); await page.keyboard.press('Enter')
await type(160,20,'Сумма'); await type(160,44,'10'); await type(160,68,'20'); await type(160,92,'30'); await type(160,116,'=СУММ(B2:B4)')
await type(460,20,'=СУММ(E1:E3)')
await page.locator('[role="grid"]').click({position:{x:460,y:20}}); await page.keyboard.press('Delete')
await type(260,20,'Статус'); await type(260,44,'Просрочка')
await page.waitForTimeout(1000)

const token = await page.evaluate(()=>localStorage.getItem('docs.access'))
const check = async (label) => {
  const res = await page.request.get(`${BASE}/api/documents/${id}/`, {headers:{Authorization:`Bearer ${token}`}})
  const body = await res.json()
  const cells = body.content?.sheets?.[0]?.cells || {}
  console.log(label, Object.keys(cells).length, 'ячеек:', JSON.stringify(Object.entries(cells).map(([k,v])=>k+'='+v.value).slice(0,8)))
}
await check('до ухода:')
await page.getByLabel('К списку таблиц').click(); await page.waitForURL(/\/documents$/)
await page.waitForTimeout(3000)
await check('после ухода:')
await b.close()
