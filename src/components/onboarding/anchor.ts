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
 * Real height of the mobile bottom nav, read from the DOM rather than assumed
 * — 0 when it isn't rendered (desktop, where TopNav is used instead) or is
 * hidden (ActiveWorkout hides it so it doesn't stack with the Finish bar).
 * Popup placement uses this so it always clears the REAL bar regardless of
 * device safe-area inset, rather than a guessed pixel constant that can fall
 * short on notched devices and let a popup's bottom edge land under it.
 */
export function bottomNavHeight(): number {
  if (typeof document === 'undefined') return 0
  const el = document.querySelector<HTMLElement>('.bottom-nav')
  return el ? el.getBoundingClientRect().height : 0
}

/**
 * Pick the first side (in preference order) where a `popW × popH` popup fits the
 * viewport with an `offset` gap from the anchor and a `margin` from the edges;
 * otherwise fall back to the preferred side and clamp on-screen. The arrow always
 * points back at the anchor's center. The bottom edge additionally always clears
 * the mobile bottom nav (see `bottomNavHeight`) — a plain viewport-height check
 * would happily place a popup's bottom edge underneath it.
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
  const safeBottom = vh - margin - bottomNavHeight()
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
 * Track a target element's viewport rect while `active` via a continuous
 * requestAnimationFrame loop, so the spotlight/pointer stays glued to the target
 * frame-for-frame no matter what moves it — window scroll, a nested scroll
 * container, momentum/rubber-band scrolling, a programmatic smooth-scroll
 * (`ensureVisible`), a resize, late mount (route settle), or async content
 * shifting it. Returns null until found.
 *
 * A per-frame loop replaces the old scroll-listener + interval combo: scroll
 * events (especially momentum on iOS and smooth-scroll animations) fire at less
 * than one-per-frame and left the outline visibly lagging behind the element.
 * The measurement is cheap (one `getBoundingClientRect`), and the unchanged-rect
 * guard means a stationary target triggers zero re-renders, so an idle overlay
 * costs only the read, not React work.
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

    const frame = () => {
      const el = getEl()
      if (!el) {
        setRect(prev => (prev === null ? prev : null))
      } else {
        const r = el.getBoundingClientRect()
        setRect(prev => {
          if (prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) {
            return prev
          }
          return { top: r.top, left: r.left, width: r.width, height: r.height }
        })
      }
      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [getEl, active])

  return rect
}

/**
 * Bring an onboarding target comfortably into view before a hint points at it, so
 * the thing being highlighted is actually on screen. No-op when it already sits
 * inside a centered comfort band (clear of the top nav and the bottom nav / rest
 * bar / mobile sheet), so we never yank the page for something the user can
 * already see. The smooth scroll is tracked frame-for-frame by `useAnchorRect`,
 * so the popup rides along and lands attached to the target.
 */
export function ensureVisible(el: HTMLElement | null): void {
  if (!el || typeof window === 'undefined') return
  const r = el.getBoundingClientRect()
  const topSafe = 96
  const bottomSafe = window.innerHeight - 140
  // A target taller than the comfort band can't fit inside it, so we only ask
  // that its top edge be within the band; otherwise it must fit entirely.
  const tallerThanBand = r.height > bottomSafe - topSafe
  const comfortablyVisible = tallerThanBand
    ? r.top >= topSafe && r.top <= bottomSafe
    : r.top >= topSafe && r.bottom <= bottomSafe
  if (comfortablyVisible) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/** Resolve a coach-mark / tooltip target by its `data-onboard` attribute value. */
export function onboardTarget(key: string): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.querySelector<HTMLElement>(`[data-onboard="${key}"]`)
}
