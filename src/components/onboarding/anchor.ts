'use client'
import { useEffect, useState } from 'react'

/**
 * Shared positioning helpers for the onboarding overlay (coach marks + one-off
 * tooltips). Everything works in viewport (fixed) coordinates so a popup can't be
 * clipped by an ancestor's `overflow` — important because most targets live inside
 * the app's single scrolling `.app-main` column.
 */

export type Side = 'top' | 'bottom' | 'left' | 'right'

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

export interface Placed {
  top: number
  left: number
  side: Side
  /** Pointer offset from the popup's top-left, kept 12px inside each edge. */
  arrowLeft: number
  arrowTop: number
}

/**
 * Pick the first side (in preference order) where a `popW × popH` popup fits the
 * viewport with an `offset` gap from the anchor and a `margin` from the edges;
 * otherwise fall back to the preferred side and clamp on-screen. The arrow always
 * points back at the anchor's center.
 */
export function placePopover(
  anchor: Rect,
  popW: number,
  popH: number,
  opts: { preferred?: Side[]; offset?: number; margin?: number } = {},
): Placed {
  const offset = opts.offset ?? 10
  const margin = opts.margin ?? 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const safeTop = margin
  const safeBottom = vh - margin
  const safeLeft = margin
  const safeRight = vw - margin

  const order = opts.preferred ?? ['bottom', 'top', 'right', 'left']

  const at = (side: Side): { top: number; left: number } => {
    if (side === 'bottom') return { top: anchor.top + anchor.height + offset, left: anchor.left + anchor.width / 2 - popW / 2 }
    if (side === 'top') return { top: anchor.top - offset - popH, left: anchor.left + anchor.width / 2 - popW / 2 }
    if (side === 'right') return { top: anchor.top + anchor.height / 2 - popH / 2, left: anchor.left + anchor.width + offset }
    return { top: anchor.top + anchor.height / 2 - popH / 2, left: anchor.left - offset - popW }
  }

  const fits = (side: Side): { top: number; left: number } | null => {
    const p = at(side)
    if (side === 'bottom' && p.top + popH > safeBottom) return null
    if (side === 'top' && p.top < safeTop) return null
    if (side === 'right' && p.left + popW > safeRight) return null
    if (side === 'left' && p.left < safeLeft) return null
    return p
  }

  let side: Side = order[0]
  let pos: { top: number; left: number } | null = null
  for (const s of order) {
    const p = fits(s)
    if (p) {
      side = s
      pos = p
      break
    }
  }
  if (!pos) {
    side = order[0]
    pos = at(side)
  }

  const left = Math.min(Math.max(pos.left, safeLeft), Math.max(safeLeft, safeRight - popW))
  const top = Math.min(Math.max(pos.top, safeTop), Math.max(safeTop, safeBottom - popH))

  const anchorCx = anchor.left + anchor.width / 2
  const anchorCy = anchor.top + anchor.height / 2
  const arrowLeft = Math.min(Math.max(anchorCx - left, 14), Math.max(14, popW - 14))
  const arrowTop = Math.min(Math.max(anchorCy - top, 14), Math.max(14, popH - 14))

  return { top, left, side, arrowLeft, arrowTop }
}

/**
 * Track a target element's viewport rect while `active`, re-measuring on scroll
 * (capture phase, so nested scroll containers count), resize, its own size
 * changes, and a low-frequency interval that also catches the element mounting
 * late (route settle) or async content shifting it. Returns null until found.
 */
export function useAnchorRect(getEl: () => HTMLElement | null, active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)

  useEffect(() => {
    if (!active) {
      // Clearing the tracked rect when the overlay deactivates — a sync from the
      // `active` prop (external control), not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRect(null)
      return
    }
    let raf = 0
    let observed: HTMLElement | null = null
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => schedule()) : null

    const measure = () => {
      const el = getEl()
      if (!el) {
        setRect(prev => (prev === null ? prev : null))
        return
      }
      if (ro && observed !== el) {
        if (observed) ro.unobserve(observed)
        ro.observe(el)
        observed = el
      }
      const r = el.getBoundingClientRect()
      setRect(prev => {
        if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) {
          return prev
        }
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      })
    }
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    const interval = window.setInterval(measure, 200)

    return () => {
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
      window.clearInterval(interval)
      cancelAnimationFrame(raf)
      ro?.disconnect()
    }
  }, [getEl, active])

  return rect
}

/** Resolve a coach-mark / tooltip target by its `data-onboard` attribute value. */
export function onboardTarget(key: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>(`[data-onboard="${key}"]`)
}
