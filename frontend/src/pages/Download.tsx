/**
 * Страница «Скачать приложение» — /download.
 *
 * Открывается и без входа: ссылку отправляют новому сотруднику до того, как
 * ему завели учётную запись. Установщики лежат на сервере в /downloads/,
 * а что там сейчас — описано в latest.json (его пишет scripts/push-desktop.sh).
 *
 * Своя система выделена и стоит первой: человек с Windows не должен
 * разбираться, какая из двух кнопок его.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '@/api'
import { useAuth } from '@/store/auth'
import { DownloadIcon, MonitorIcon } from '@/components/icons'
import type { DesktopInstaller, DesktopRelease } from '@/types'

type Platform = 'windows' | 'mac'

type Visitor = Platform | 'mobile' | 'other'

/** Система посетителя по строке браузера — только чтобы выделить нужную кнопку. */
function detectVisitor(): Visitor {
  const agent = navigator.userAgent
  if (/Android|iPhone|iPad|iPod/i.test(agent)) return 'mobile'
  if (/Windows/i.test(agent)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(agent)) return 'mac'
  return 'other'
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
    note: 'Для Mac на Apple M1–M4 и на Intel, macOS 12 и новее',
    steps: [
      'Откройте скачанный файл и перетащите «ALI trade» в папку «Программы».',
      'При первом запуске нажмите на значок правой кнопкой мыши → «Открыть» → «Открыть».',
      'Если macOS не даёт открыть: «Системные настройки» → «Конфиденциальность и безопасность» → «Всё равно открыть».',
    ],
  },
}

export function DownloadPage() {
  const user = useAuth((state) => state.user)
  const [release, setRelease] = useState<DesktopRelease | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [error, setError] = useState('')
  const visitor = detectVisitor()

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

  // Своя система первой, вторая — следом.
  const order: Platform[] = visitor === 'mac' ? ['mac', 'windows'] : ['windows', 'mac']

  return (
    <div className="flex min-h-dvh items-center justify-center bg-surface-muted px-4 py-10">
      <main className="w-full max-w-2xl rounded-2xl border border-hairline bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-start gap-3">
          <span className="mt-0.5 text-accent">
            <MonitorIcon size={30} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-ink">
              ALI<span className="text-accent"> trade</span> для компьютера
            </h1>
            <p className="mt-1 text-sm text-ink-muted">
              Те же таблицы в отдельном окне, с ярлыком на рабочем столе. Новые
              возможности приходят сами — переустанавливать приложение не нужно.
            </p>
          </div>
        </div>

        {insideApp() && (
          <p role="status" className="mb-6 rounded-xl bg-accent/10 px-4 py-3 text-sm text-ink">
            Вы уже в приложении — скачивать ничего не нужно.
          </p>
        )}

        {visitor === 'mobile' && (
          <p role="status" className="mb-6 rounded-xl bg-surface-muted px-4 py-3 text-sm text-ink">
            Для телефона приложение не нужно: откройте этот сайт в браузере. Ниже —
            установщики для компьютера, ссылку можно отправить себе на почту.
          </p>
        )}

        {state === 'loading' && (
          <div role="status" aria-label="Загрузка" className="grid gap-4 sm:grid-cols-2">
            <div className="skeleton h-40 rounded-xl" />
            <div className="skeleton h-40 rounded-xl" />
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
          <div className="rounded-xl border border-hairline px-4 py-6 text-center">
            <h2 className="mb-1 font-medium text-ink">Установщики ещё не выложены</h2>
            <p className="text-sm text-ink-muted">
              Пока пользуйтесь сайтом в браузере. Администратор выкладывает приложение
              командой <code className="rounded bg-surface-muted px-1">scripts/push-desktop.sh</code>.
            </p>
          </div>
        )}

        {state === 'ready' && release && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {order.map((platform) => (
                <PlatformCard
                  key={platform}
                  platform={platform}
                  installer={release[platform]}
                  version={release.version}
                  recommended={platform === visitor}
                />
              ))}
            </div>
            <p className="mt-4 text-xs text-ink-muted">
              Версия {release.version}
              {release.published && ` от ${new Date(release.published).toLocaleDateString('ru-RU')}`}
            </p>
          </>
        )}

        <div className="mt-6 border-t border-hairline pt-4 text-sm">
          <Link to={user ? '/documents' : '/login'} className="text-ink-muted hover:underline">
            {user ? 'Вернуться к таблицам' : 'Войти на сайте'}
          </Link>
        </div>
      </main>
    </div>
  )
}

type CardProps = {
  platform: Platform
  installer: DesktopInstaller | null
  version: string
  recommended: boolean
}

/** Карточка одной системы: кнопка скачивания и что делать после. */
function PlatformCard({ platform, installer, version, recommended }: CardProps) {
  const info = PLATFORMS[platform]

  return (
    <section
      aria-labelledby={`download-${platform}`}
      className={[
        'flex flex-col rounded-xl border p-4',
        recommended ? 'border-accent bg-accent/5' : 'border-hairline',
      ].join(' ')}
    >
      <div className="mb-1 flex items-center gap-2">
        <h2 id={`download-${platform}`} className="text-lg font-semibold text-ink">
          {info.title}
        </h2>
        {recommended && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
            Ваша система
          </span>
        )}
      </div>
      <p className="mb-4 text-xs text-ink-muted">{info.note}</p>

      {installer ? (
        <a
          href={`/downloads/${encodeURIComponent(installer.file)}`}
          download={installer.file}
          aria-label={`Скачать для ${info.title}, ${megabytes(installer.size)}`}
          className={[
            'mb-4 flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 py-2.5 text-sm font-medium',
            recommended
              ? 'bg-accent text-white hover:opacity-90'
              : 'border border-hairline text-ink hover:bg-surface-muted',
          ].join(' ')}
        >
          <DownloadIcon size={18} />
          Скачать
          <span className={recommended ? 'text-white/80' : 'text-ink-muted'}>
            · {megabytes(installer.size)}
          </span>
        </a>
      ) : (
        <p className="mb-4 rounded-full border border-dashed border-hairline px-4 py-2.5 text-center text-sm text-ink-muted">
          Версия {version} для {info.title} готовится
        </p>
      )}

      <ol className="list-decimal space-y-1.5 pl-5 text-xs text-ink-muted">
        {info.steps.map((stepText) => (
          <li key={stepText}>{stepText}</li>
        ))}
      </ol>
    </section>
  )
}
