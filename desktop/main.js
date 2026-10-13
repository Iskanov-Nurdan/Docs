/**
 * ALI trade для Windows — окно рабочего сайта.
 *
 * Приложение не несёт свою копию интерфейса, а открывает сервер: всё, что
 * выкладывается через scripts/push-web.sh, появляется здесь при следующем
 * запуске само, без переустановки. Вход, токены и правки, накопленные без
 * сети (IndexedDB), хранятся в профиле приложения и переживают перезапуск.
 *
 * Безопасность: странице не даётся ни доступа к Node, ни мостов в систему.
 * Переходить окно может только по своему адресу — любая чужая ссылка
 * открывается в обычном браузере.
 */
const { app, BrowserWindow, Menu, dialog, session, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

// Для разработки: `npm run dev` открывает локальный docker (localhost:8080),
// а переменная ALITRADE_URL — любой другой адрес.
const APP_URL = process.env.ALITRADE_URL
  || (process.argv.includes('--dev') ? 'http://localhost:8080/' : 'https://app.alitrade.tw1.ru/')
const APP_ORIGIN = new URL(APP_URL).origin

const ICON = path.join(__dirname, 'assets', 'icon.png')
const OFFLINE_PAGE = path.join(__dirname, 'offline.html')
const STATE_FILE = () => path.join(app.getPath('userData'), 'window.json')

/** @type {BrowserWindow | null} */
let mainWindow = null

// ------------------------------ Один экземпляр ------------------------------
// Второй запуск не открывает второе окно с той же таблицей, а поднимает первое:
// два окна одного профиля делили бы одно хранилище и путали бы правки.
const isPrimary = app.requestSingleInstanceLock()
if (!isPrimary) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

// --------------------------- Размер и место окна ---------------------------

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8'))
    if (Number.isFinite(state.width) && Number.isFinite(state.height)) return state
  } catch {
    // Первый запуск или файл испорчен — откроемся по умолчанию.
  }
  return { width: 1366, height: 860, maximized: true }
}

function saveWindowState(window) {
  try {
    const bounds = window.getNormalBounds()
    fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...bounds, maximized: window.isMaximized() }))
  } catch (error) {
    console.warn('Не удалось сохранить положение окна:', error)
  }
}

// ------------------------------- Переходы -------------------------------

const isOwnUrl = (url) => {
  try {
    return new URL(url).origin === APP_ORIGIN
  } catch {
    return false
  }
}

/** Чужие адреса — в системный браузер, и только http(s) и почта. */
function openOutside(url) {
  try {
    const { protocol } = new URL(url)
    if (['http:', 'https:', 'mailto:'].includes(protocol)) void shell.openExternal(url)
  } catch {
    // Битая ссылка — молча ничего не открываем.
  }
}

function showOffline(window) {
  void window.loadFile(OFFLINE_PAGE, { query: { url: APP_URL } })
}

// -------------------------------- Окно --------------------------------

function createWindow() {
  const state = readWindowState()

  mainWindow = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 360,
    minHeight: 480,
    title: 'ALI trade',
    icon: ICON,
    show: false,
    // Меню спрятано: таблице нужна вся высота. Alt показывает его.
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  if (state.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('close', () => mainWindow && saveWindowState(mainWindow))
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  const contents = mainWindow.webContents

  // Сервер недоступен или нет интернета — своя страница с «Повторить»,
  // а не серая ошибка Chromium. -3 — переход отменён, это не сбой.
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !isOwnUrl(url)) return
    showOffline(mainWindow)
  })

  // Сервер ответил, но ошибкой (502 при перезапуске после выкладки) —
  // did-fail-load на это не срабатывает, и на экране осталась бы страница
  // nginx «502 Bad Gateway».
  contents.on('did-navigate', (_event, url, httpResponseCode) => {
    if (isOwnUrl(url) && httpResponseCode >= 500) showOffline(mainWindow)
  })

  // Упавшая вкладка поднимается сама: правки при этом не теряются, они в
  // IndexedDB. Но не сразу и не бесконечно: если страница падает снова и
  // снова, мгновенные перезагрузки только греют процессор — после трёх
  // падений за минуту показываем «Нет связи», а оттуда повтор раз в 15 секунд.
  const crashes = []
  contents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return
    const now = Date.now()
    while (crashes.length > 0 && now - crashes[0] > 60_000) crashes.shift()
    crashes.push(now)
    console.warn('Страница упала:', details.reason, `(${crashes.length} за минуту)`)
    if (crashes.length >= 3) {
      showOffline(mainWindow)
      return
    }
    setTimeout(() => {
      if (!contents.isDestroyed()) contents.reload()
    }, 1000 * crashes.length)
  })

  void mainWindow.loadURL(APP_URL)
}

// ------------------------------- Все окна -------------------------------
//
// Ограничения на переходы ставятся на каждое окно приложения, а не только на
// главное: окно, открытое со своего сайта (публичная страница, выгрузка),
// иначе могло бы уйти на любой чужой адрес и открыть оттуда новые окна.

app.on('web-contents-created', (_event, contents) => {
  // Ссылки «открыть в новой вкладке»: свои — новым окном приложения,
  // чужие — в браузере.
  contents.setWindowOpenHandler(({ url }) => {
    if (isOwnUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          icon: ICON,
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        },
      }
    }
    openOutside(url)
    return { action: 'deny' }
  })

  const guard = (event, url) => {
    if (isOwnUrl(url)) return
    event.preventDefault()
    openOutside(url)
  }
  contents.on('will-navigate', guard)
  // Перенаправление сервером на чужой адрес — тот же переход, только
  // начатый не страницей.
  contents.on('will-redirect', guard)
})

// -------------------------------- Меню --------------------------------
//
// Правки (Ctrl+Z, Ctrl+C, Ctrl+F) в меню намеренно не заведены: таблица
// обрабатывает их сама, а пункт меню перехватил бы клавиши раньше неё —
// и отмена в таблице перестала бы работать.

function buildMenu() {
  const template = [
    {
      label: 'Файл',
      submenu: [
        { label: 'Обновить', accelerator: 'F5', click: () => mainWindow?.webContents.reload() },
        {
          label: 'Обновить без кеша',
          accelerator: 'Ctrl+F5',
          click: () => mainWindow?.webContents.reloadIgnoringCache(),
        },
        { type: 'separator' },
        { label: 'Выход', role: 'quit' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { label: 'Крупнее', role: 'zoomIn', accelerator: 'Ctrl+=' },
        { label: 'Мельче', role: 'zoomOut', accelerator: 'Ctrl+-' },
        { label: 'Обычный размер', role: 'resetZoom', accelerator: 'Ctrl+0' },
        { type: 'separator' },
        { label: 'Во весь экран', role: 'togglefullscreen', accelerator: 'F11' },
        { label: 'Инструменты разработчика', role: 'toggleDevTools', accelerator: 'Ctrl+Shift+I' },
      ],
    },
    {
      label: 'Справка',
      submenu: [
        { label: 'Открыть в браузере', click: () => openOutside(APP_URL) },
        {
          label: 'О программе',
          click: () =>
            dialog.showMessageBox({
              type: 'info',
              title: 'О программе',
              message: `ALI trade ${app.getVersion()}`,
              detail: `Сервер: ${APP_ORIGIN}\nИнтерфейс обновляется вместе с сервером — переустанавливать приложение не нужно.`,
            }),
        },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// -------------------------------- Запуск --------------------------------

app.whenReady().then(() => {
  // Второй экземпляр уже передал управление первому и закрывается —
  // своё окно ему открывать нельзя.
  if (!isPrimary) return

  // Разрешения — только своему сайту и только нужные: буфер обмена и
  // уведомления. Камера, микрофон и геолокация таблицам не нужны.
  const allowed = new Set(['clipboard-read', 'clipboard-sanitized-write', 'notifications', 'fullscreen'])
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isOwnUrl(contents.getURL()) && allowed.has(permission))
  })

  buildMenu()
  createWindow()
})

app.on('window-all-closed', () => app.quit())
