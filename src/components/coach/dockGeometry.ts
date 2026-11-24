import type { CoachDockId } from './CoachProvider'
import { dockFromFlick } from './coachMotion'

/** Matches `.coach-fab` width/height in globals.css */
export const COACH_FAB_SIZE = 56

/** Edge inset used by every dock rule (`16px`) */
export const COACH_FAB_MARGIN = 16

/** Bottom-nav strip height used in mobile bottom-dock clearance */
const BOTTOM_NAV_H = 64

/** Desktop TopNav height — mirrors `--nav-h` in globals.css */
const DESKTOP_NAV_H = 72

const DESKTOP_MQ = '(min-width: 768px)'

export type DockPoint = { x: number; y: number }

let probe: HTMLDivElement | null = null

function safeInset(side: 'top' | 'bottom'): number {
  if (typeof document === 'undefined') return 0
  if (!probe) {
    probe = document.createElement('div')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top);' +
      'padding-bottom:env(safe-area-inset-bottom);' +
      'width:0;height:0;overflow:hidden;'
    document.documentElement.appendChild(probe)
  }
  const cs = getComputedStyle(probe)
  const n = parseFloat(side === 'top' ? cs.paddingTop : cs.paddingBottom)
  return Number.isFinite(n) ? n : 0
}

function isDesktop(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia(DESKTOP_MQ).matches
  } catch {
    return false
  }
}

/**
 * Top-left pixel position for a docked FAB — mirrors the CSS dock rules in
 * globals.css (safe-area, bottom-nav clearance, desktop TopNav offset).
 */
export function dockPixelPosition(dock: CoachDockId): DockPoint {
  const w = typeof window !== 'undefined' ? window.innerWidth : 0
  const h = typeof window !== 'undefined' ? window.innerHeight : 0
  const safeTop = safeInset('top')
  const safeBottom = safeInset('bottom')
  const desktop = isDesktop()
  const margin = COACH_FAB_MARGIN
  const size = COACH_FAB_SIZE

  const bottomNavDock = !desktop && w >= 320 && w <= 767
  const side = bottomNavDock && (dock === 'br' || dock === 'bl') ? 6 : margin
  const leftX = side
  const rightX = w - side - size

  let topY: number
  let bottomY: number

  if (desktop) {
    topY = DESKTOP_NAV_H + safeTop + margin
    bottomY = h - (margin + safeBottom) - size
  } else {
    topY = margin + safeTop
    // CSS: bottom: calc(64px + max(8px, env(safe-area-inset-bottom)) + 16px)
    const bottomClear = Math.max(8, safeBottom) + (bottomNavDock ? 3 : BOTTOM_NAV_H + margin)
    bottomY = h - bottomClear - size
  }

  switch (dock) {
    case 'tl':
      return { x: leftX, y: topY }
    case 'tr':
      return { x: rightX, y: topY }
    case 'bl':
      return { x: leftX, y: bottomY }
    case 'br':
    default:
      return { x: rightX, y: bottomY }
  }
}

const DOCKS: CoachDockId[] = ['tl', 'tr', 'bl', 'br']

/** Nearest corner dock to a viewport point (typically pointer / FAB center). */
export function nearestDock(x: number, y: number): CoachDockId {
  let best: CoachDockId = 'br'
  let bestDist = Infinity
  for (const dock of DOCKS) {
    const p = dockPixelPosition(dock)
    // Compare to FAB center so edges feel balanced.
    const cx = p.x + COACH_FAB_SIZE / 2
    const cy = p.y + COACH_FAB_SIZE / 2
    const d = (x - cx) ** 2 + (y - cy) ** 2
    if (d < bestDist) {
      bestDist = d
      best = dock
    }
  }
  return best
}

/**
 * Furthest safe corner in the flick direction — maximizes projection of
 * (dockCenter − releasePoint) onto velocity. Falls back to nearest if the
 * flick doesn't point toward any dock.
 */
export function furthestDockInDirection(
  x: number,
  y: number,
  vx: number,
  vy: number,
): CoachDockId {
  let best: CoachDockId = 'br'
  let bestScore = -Infinity
  for (const dock of DOCKS) {
    const p = dockPixelPosition(dock)
    const cx = p.x + COACH_FAB_SIZE / 2
    const cy = p.y + COACH_FAB_SIZE / 2
    const score = (cx - x) * vx + (cy - y) * vy
    if (score > bestScore) {
      bestScore = score
      best = dock
    }
  }
  if (bestScore <= 0) return nearestDock(x, y)
  return best
}

/**
 * Release → dock: flick (|v| ≥ threshold) uses axis-aware dockFromFlick
 * (preserves the non-dominant half); otherwise nearest safe corner.
 */
export function dockFromRelease(
  x: number,
  y: number,
  vx: number,
  vy: number,
  flickThresholdPxS: number,
): CoachDockId {
  const speed = Math.hypot(vx, vy)
  if (speed >= flickThresholdPxS) {
    const w = typeof window !== 'undefined' ? window.innerWidth : 390
    const h = typeof window !== 'undefined' ? window.innerHeight : 844
    return dockFromFlick(x, y, vx, vy, w, h)
  }
  return nearestDock(x, y)
}

/** How far above the bottom nav (px) the orb starts being pulled into it. */
const NAV_CAPTURE = 28

/** Phone widths where the bottom docks sit inside the bottom nav bar. */
export function navDocking(): boolean {
  if (typeof window === 'undefined') return false
  const w = window.innerWidth
  return !isDesktop() && w >= 320 && w <= 767
}

export const isNavDock = (dock: CoachDockId): dock is 'bl' | 'br' =>
  navDocking() && (dock === 'bl' || dock === 'br')

/**
 * The nav-bar slot a point is over (or just above), by side; null when the
 * point is clear of the bar or the bar doesn't host docks at this width.
 */
export function navSlotAt(x: number, y: number): 'bl' | 'br' | null {
  if (!navDocking() || typeof document === 'undefined') return null
  const nav = document.querySelector('.bottom-nav')
  if (!nav) return null
  const top = nav.getBoundingClientRect().top
  if (y < top - NAV_CAPTURE) return null
  return x < window.innerWidth / 2 ? 'bl' : 'br'
}
