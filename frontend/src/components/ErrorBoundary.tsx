/**
 * Граница ошибок.
 *
 * Без неё любое исключение в отрисовке гасит всё приложение: React снимает
 * дерево целиком, и человек остаётся с пустой белой страницей, на которой
 * нечего нажать и нечего прочитать. Одна сломанная таблица не должна выглядеть
 * как сломанный сайт.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = {
  children: ReactNode
  /** Что показать вместо упавшего куска. По умолчанию — страница с ошибкой. */
  fallback?: ReactNode
}

type State = { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // В консоль, а не на сервер: своего приёмника ошибок у проекта пока нет,
    // а молча терять причину падения нельзя.
    console.error('Сбой в интерфейсе:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    if (this.props.fallback !== undefined) return this.props.fallback

    return (
      <div className="flex min-h-screen items-center justify-center p-6" role="alert">
        <div className="max-w-md text-center">
          <h1 className="mb-2 text-lg font-semibold text-ink">Страница не открылась</h1>
          <p className="mb-5 text-sm text-ink-muted">
            Что-то пошло не так при отрисовке. Данные не потеряны — они сохранены на сервере.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Обновить страницу
          </button>
        </div>
      </div>
    )
  }
}
