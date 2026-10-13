/**
 * Страница «Скачать» — /download, приложение для Windows и macOS.
 *
 * Одна большая кнопка — под систему посетителя: человек с Windows не должен
 * разбираться, какой из файлов его. Установщик для другой системы — скромной
 * ссылкой под ней.
 *
 * Вошедшему страница показывается внутри сайта, с левым меню — это обычный
 * его раздел. Без входа она тоже открывается: ссылку отправляют новому
 * сотруднику до того, как ему завели учётную запись.
 *
 * Установщики лежат на сервере в /downloads/, а что там сейчас — описано
 * в latest.json (его пишет scripts/push-desktop.sh).
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/api'
import { AppLayout } from '@/components/AppLayout'
import { useAuth } from '@/store/auth'
import { DownloadIcon, MonitorIcon } from '@/components/icons'
import type { DesktopRelease } from '@/types'

type Platform = 'windows' | 'mac'

/** Система посетителя по строке браузера — только чтобы выбрать кнопку. */
function detectPlatform(): { platform: Platform; mobile: boolean } {
  const agent = navigator.userAgent
  const mobile = /Android|iPhone|iPad|iPod/i.test(agent)
  const mac = !mobile && /Macintosh|Mac OS X/i.test(agent)
  return { platform: mac ? 'mac' : 'windows', mobile }
}

/** Страница открыта внутри самого приложения — скачивать нечего. */
const insideApp = () => /Electron/i.test(navigator.userAgent)

const megabytes = (bytes: number) =>
  `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(bytes / 1024 / 1024)} МБ`

const PLATFORMS: Record<Platform, { title: string; note: string; steps: string[] }> = {
  windows: {
    title: 'Windows',
    note: 'Windows 10 и 11, 64 бита',
    steps: [
      'Запустите скачанный файл и нажмите «Далее» — права администратора не нужны.',
      'Если Windows пишет «Windows защитила ваш компьютер», нажмите «Подробнее» → «Выполнить в любом случае».',
      'Ярлык «ALI trade» появится на рабочем столе и в меню «Пуск».',
    ],
  },
  mac: {
    title: 'macOS',
    note: 'Mac на Apple M1–M4 и на Intel, macOS 12 и новее',
    steps: [
      'Откройте скачанный файл и перетащите «ALI trade» в папку «Программы».',
      'При первом запуске нажмите на значок правой кнопкой мыши → «Открыть» → «Открыть».',
      'Если macOS не даёт открыть: «Системные настройки» → «Конфиденциальность и безопасность» → «Всё равно открыть».',
    ],
  },
}

export function DownloadPage() {
  const { user, initialized } = useAuth()

  // Пока сессия восстанавливается, неизвестно, рисовать ли меню сайта.
  if (!initialized) return <p className="p-12 text-center text-ink-muted">Загрузка…</p>

  if (user) {
    return (
      <AppLayout title="Скачать">
        <div className="mx-auto w-full max-w-xl px-4 py-6 sm:py-10">
          <DownloadContent />
        </div>
      </AppLayout>
    )
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4 py-10">
      <main className="w-full max-w-xl rounded-2xl border border-hairline bg-surface p-6 shadow-sm sm:p-8">
        <DownloadContent />
        <div className="mt-6 border-t border-hairline pt-4 text-center text-sm">
          <Link to="/login" className="text-ink-muted hover:underline">
            Войти на сайте
          </Link>
        </div>
      </main>
    </div>
  )
}

/** Сама страница: заголовок, кнопка, ссылка на другую систему и что делать после. */
function DownloadContent() {
  const [release, setRelease] = useState<DesktopRelease | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [error, setError] = useState('')
  const { platform: visitor, mobile } = detectPlatform()

  const load = useCallback(async () => {
    setState('loading')
    setError('')
    try {
      setRelease(await api.desktopRelease())
      setState('ready')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось загрузить сведения о приложении')
      setState('error')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const other: Platform = visitor === 'mac' ? 'windows' : 'mac'
  const main = release?.[visitor] ?? null
  const second = release?.[other] ?? null
  const info = PLATFORMS[visitor]

  return (
    <div className="text-center">
      <span className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <MonitorIcon size={30} />
      </span>
      <h1 className="text-2xl font-semibold text-ink">
        ALI<span className="text-accent"> trade</span> для компьютера
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
        Те же таблицы в отдельном окне, с ярлыком на рабочем столе. Новые
        возможности приходят сами — переустанавливать приложение не нужно.
      </p>

      {insideApp() && (
        <p role="status" className="mt-6 rounded-xl bg-accent/10 px-4 py-3 text-sm text-ink">
          Вы уже в приложении — скачивать ничего не нужно.
        </p>
      )}

      {mobile && (
        <p role="status" className="mt-6 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink">
          На телефоне приложение не нужно — пользуйтесь сайтом в браузере.
          Установщик откройте на компьютере.
        </p>
      )}

      <div className="mt-8">
        {state === 'loading' && (
          <div role="status" aria-label="Загрузка">
            <div className="skeleton mx-auto h-12 w-64 rounded-full" />
            <div className="skeleton mx-auto mt-3 h-4 w-40 rounded" />
          </div>
        )}

        {state === 'error' && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="mb-2">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-full border border-red-300 px-3 py-1 text-xs hover:bg-red-100"
            >
              Повторить
            </button>
          </div>
        )}

        {state === 'ready' && !release && (
          <div className="rounded-xl border border-hairline px-4 py-6">
            <h2 className="mb-1 font-medium text-ink">Приложение ещё не выложено</h2>
            <p className="text-sm text-ink-muted">Пока пользуйтесь сайтом в браузере.</p>
          </div>
        )}

        {state === 'ready' && release && (
          <>
            {main ? (
              <a
                href={`/downloads/${encodeURIComponent(main.file)}`}
                download={main.file}
                className="inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-accent px-7 py-3.5 text-base font-semibold text-white shadow-sm hover:opacity-90"
              >
                <DownloadIcon size={20} />
                Скачать для {info.title}
              </a>
            ) : (
              <p className="mx-auto max-w-sm rounded-xl border border-dashed border-hairline px-4 py-3 text-sm text-ink-muted">
                Версия для {info.title} готовится.
                {second && ' Пока можно скачать для другой системы — ссылка ниже.'}
              </p>
            )}

            <p className="mt-3 text-xs text-ink-muted">
              {main && `${megabytes(main.size)} · `}
              версия {release.version} · {info.note}
            </p>

            <p className="mt-4 text-sm">
              {second ? (
                <a
                  href={`/downloads/${encodeURIComponent(second.file)}`}
                  download={second.file}
                  className="text-accent hover:underline"
                >
                  Скачать для {PLATFORMS[other].title} ({megabytes(second.size)})
                </a>
              ) : (
                <span className="text-ink-muted">Версия для {PLATFORMS[other].title} готовится</span>
              )}
            </p>

            {main && (
              <div className="mx-auto mt-8 max-w-md rounded-xl bg-surface-muted px-4 py-3 text-left">
                <h2 className="mb-2 text-sm font-medium text-ink">После скачивания</h2>
                <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-muted">
                  {info.steps.map((stepText) => (
                    <li key={stepText}>{stepText}</li>
                  ))}
                </ol>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
