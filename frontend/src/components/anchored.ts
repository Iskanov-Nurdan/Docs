/**
 * Положение всплывающего слоя рядом с кнопкой, которая его открыла.
 *
 * Меню и выпадающие списки рисуются не внутри своей кнопки, а в конце
 * страницы, через портал. Иначе любой предок с прокруткой обрезает слой: так
 * пропадал список форматов в панели таблицы и меню документа в списке — на
 * телефоне оба лежат внутри полосы, которая едет вбок.
 *
 * Раз слой вынесен из потока, положение приходится считать самим: от кнопки,
 * в координатах окна. Здесь же решается, куда он раскроется — вниз или вверх,
 * влево или вправо: у нижнего края экрана список, открытый вниз, оказался бы
 * за пределами видимого.
 */
import { useCallback, useEffect, useState } from 'react'

/** С какой стороны кнопки слой выравнивается по умолчанию. */
export type AnchorAlign = 'left' | 'right'

/** Отступ от кнопки и от краёв экрана. */
const GAP = 6
const EDGE = 8

/** Сколько места по высоте слою нужно, чтобы раскрыться вниз. */
const MIN_SPACE = 180

export function useAnchoredPosition(
  anchor: React.RefObject<HTMLElement | null>,
  open: boolean,
  align: AnchorAlign = 'left',
  /**
   * Тянуть слой минимум до ширины кнопки — как ведёт себя выпадающий список.
   * Меню открывается от узкой кнопки со значком, и ширину ему задаёт свой
   * класс: растягивать его до размера значка незачем.
   */
  matchWidth = true,
): React.CSSProperties {
  const [style, setStyle] = useState<React.CSSProperties>({ visibility: 'hidden' })

  const measure = useCallback(() => {
    const element = anchor.current
    if (!element) return

    const rect = element.getBoundingClientRect()
    const { innerWidth: width, innerHeight: height } = window

    const below = height - rect.bottom - GAP - EDGE
    const above = rect.top - GAP - EDGE
    // Вниз — если там помещается или всё равно просторнее, чем вверху.
    const dropDown = below >= MIN_SPACE || below >= above

    const next: React.CSSProperties = {
      position: 'fixed',
      maxHeight: Math.max((dropDown ? below : above), MIN_SPACE),
      zIndex: 60,
    }
    if (matchWidth) next.minWidth = rect.width

    if (dropDown) next.top = rect.bottom + GAP
    else next.bottom = height - rect.top + GAP

    // Выравнивание по той стороне, с которой слой не упрётся в край экрана.
    if (align === 'right' || rect.left > width / 2) {
      next.right = Math.max(width - rect.right, EDGE)
      next.maxWidth = width - EDGE - (next.right as number)
    } else {
      next.left = Math.max(rect.left, EDGE)
      next.maxWidth = width - EDGE - (next.left as number)
    }

    setStyle(next)
  }, [anchor, align, matchWidth])

  useEffect(() => {
    if (!open) {
      setStyle({ visibility: 'hidden' })
      return
    }

    measure()

    // Прокрутка любого предка уводит кнопку, а слой остаётся на месте —
    // поэтому слушаем на стадии перехвата, иначе внутренние полосы молчат.
    const update = () => measure()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, measure])

  return style
}
