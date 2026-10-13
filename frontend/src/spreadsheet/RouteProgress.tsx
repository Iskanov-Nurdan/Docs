/**
 * Маршрут выбранного рейса по шагам — над таблицей.
 *
 * «Прибыл» отмечает точки по одной: сначала Кара-Тай, потом Нарын, и только
 * в конце — прибытие в Ош. В таблице этого не видно, и работники не понимали,
 * что кнопка отметит на этот раз. Здесь видно всё сразу: куда машина должна
 * приехать первой, второй и дальше, что уже пройдено и когда её ждать, —
 * а кнопка прямо называет, что сейчас будет отмечено.
 */
import { CheckIcon, ChevronRightIcon } from '@/components/icons'
import type { RouteProgress as Progress, RouteStop } from './routing'

type Props = {
  progress: Progress
  /** Номер машины для подписи: «01KG777». */
  vehicle: string
  editable: boolean
  now: Date
  onMark: () => void
}

/**
 * Высота полосы постоянная, и место под неё держится, даже когда выделена не
 * строка рейса. Раньше полоса появлялась и пропадала вместе с выделением, и
 * таблица под ней прыгала на 60 пикселей: человек выделял рейс, щёлкал по
 * ячейке ниже — и попадал в чужую строку, на три строки ниже.
 */
const STRIP = 'h-16 overflow-hidden border-b border-hairline bg-surface px-3'

/** Пустая полоса: место держится, а человек видит, что здесь появится. */
export function RouteProgressPlaceholder() {
  return (
    <div className={`${STRIP} flex items-center text-xs text-ink-muted`}>
      Встаньте на строку рейса — здесь появится его маршрут и кнопка отметки.
    </div>
  )
}

const two = (value: number) => String(value).padStart(2, '0')
const when = (moment: Date) =>
  `${two(moment.getDate())}.${two(moment.getMonth() + 1)} ${two(moment.getHours())}:${two(moment.getMinutes())}`

/** Подпись под точкой: что с ней и когда. */
function stopCaption(stop: RouteStop, now: Date): { text: string; late: boolean } {
  if (stop.state === 'passed') {
    return { text: stop.note ? `прошёл · ${stop.note}` : (stop.final ? 'прибыл' : 'прошёл'), late: false }
  }
  if (!stop.eta) return { text: stop.final ? 'конечная' : 'срок не посчитан', late: false }
  const late = stop.eta.getTime() < now.getTime()
  return { text: `${late ? 'опаздывает, ждали' : 'ждём'} ${when(stop.eta)}`, late }
}

export function RouteProgress({ progress, vehicle, editable, now, onMark }: Props) {
  const next = progress.stops.find((stop) => stop.state === 'next')
  const actionLabel = next
    ? (next.final ? `Отметить прибытие в ${next.place}` : `Отметить: прошёл ${next.place}`)
    : null

  const closedText = progress.closed === 'arrived'
    ? 'Рейс закрыт: машина приехала.'
    : progress.closed === 'transferred'
      ? 'Груз перегружен на другую машину — дальше он едет строкой с тем же «Груз №».'
      : progress.closed === 'cancelled'
        ? 'Рейс отменён.'
        : null

  return (
    <section
      aria-label={`Маршрут ${vehicle || 'рейса'}`}
      className={STRIP}
    >
      {/* Одна строка, без переноса: длинный маршрут прокручивается вбок,
          а высота полосы не меняется от рейса к рейсу. */}
      <div className="flex h-full flex-nowrap items-center gap-x-3">
        <span className="shrink-0 text-xs text-ink-muted">
          Маршрут{vehicle ? ` ${vehicle}` : ''}:
        </span>

        <ol className="no-scrollbar flex min-w-0 flex-1 items-start gap-1 overflow-x-auto">
          <li className="flex shrink-0 flex-col px-2 py-1">
            <span className="text-sm text-ink-muted">{progress.origin}</span>
            <span className="text-xs text-ink-muted">выезд</span>
          </li>

          {progress.stops.map((stop) => {
            const caption = stopCaption(stop, now)
            return (
              <li key={`${stop.order}-${stop.place}`} className="flex shrink-0 items-start gap-1">
                <span className="mt-2 text-ink-muted" aria-hidden="true">
                  <ChevronRightIcon size={14} />
                </span>
                <div
                  aria-current={stop.state === 'next' ? 'step' : undefined}
                  className={[
                    'flex flex-col rounded-xl border px-2.5 py-1',
                    stop.state === 'next' ? 'border-accent bg-accent/10' : 'border-transparent',
                  ].join(' ')}
                >
                  <span className="flex items-center gap-1.5 text-sm">
                    <span
                      className={[
                        'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                        stop.state === 'passed'
                          ? 'bg-emerald-600 text-white'
                          : stop.state === 'next'
                            ? 'bg-accent text-white'
                            : 'border border-hairline text-ink-muted',
                      ].join(' ')}
                    >
                      {stop.state === 'passed' ? <CheckIcon size={12} /> : stop.order}
                    </span>
                    <span className={stop.state === 'ahead' ? 'text-ink-muted' : 'font-medium text-ink'}>
                      {stop.place}
                    </span>
                    {stop.final && <span className="text-xs text-ink-muted">конечная</span>}
                  </span>
                  <span
                    className={[
                      'text-xs',
                      caption.late ? 'text-rose-600 dark:text-rose-400' : 'text-ink-muted',
                    ].join(' ')}
                  >
                    {caption.text}
                  </span>
                </div>
              </li>
            )
          })}
        </ol>

        {actionLabel ? (
          <button
            type="button"
            disabled={!editable}
            onClick={onMark}
            title={editable ? undefined : 'Таблица открыта только для просмотра'}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            <CheckIcon size={16} />
            {actionLabel}
          </button>
        ) : (
          closedText && (
            <span className="shrink-0 text-xs text-ink-muted" role="status">
              {closedText}
            </span>
          )
        )}
      </div>
    </section>
  )
}
