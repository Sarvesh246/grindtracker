import type { CoachDockId } from './CoachProvider'

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

  const leftX = margin
  const rightX = w - margin - size

  let topY: number
  let bottomY: number

  if (desktop) {
    topY = DESKTOP_NAV_H + safeTop + margin
    bottomY = h - (margin + safeBottom) - size
  } else {
    topY = margin + safeTop
    // CSS: bottom: calc(64px + max(8px, env(safe-area-inset-bottom)) + 16px)
    const bottomClear = BOTTOM_NAV_H + Math.max(8, safeBottom) + margin
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
 * Release → dock: flick (|v| ≥ threshold) picks furthest corner in that
 * direction; otherwise nearest safe corner.
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
    return furthestDockInDirection(x, y, vx, vy)
  }
  return nearestDock(x, y)
}
