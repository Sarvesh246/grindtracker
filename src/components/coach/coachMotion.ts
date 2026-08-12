/**
 * Coach motion helpers — RAF springs + CSS (no Framer Motion / motion dep).
 * Tuned for Apple-like feel: soft docks, critically damped sheet settles,
 * velocity squash without rotating the G glyph.
 */

import type { CoachDockId } from './CoachProvider'

/** Flick threshold (px/s) — intentional flicks; high enough to ignore jitter */
export const FLICK_VELOCITY_PX_S = 580

/**
 * Axis dominance for flick docking. When |primary| ≥ |secondary| × this,
 * treat as single-axis and preserve the release point's other half
 * (TR + leftward → tl, not bl).
 */
export const FLICK_AXIS_DOMINANCE = 1.55

/** FAB settle spring — softer / longer (Apple-smooth, not snappy) */
export const FAB_SPRING_K = 200
export const FAB_SPRING_C = 28
export const FAB_SPRING_VEL_CARRY = 0.5
export const FAB_SPRING_VEL_CARRY_FLICK = 0.68
export const FAB_SETTLE_POS = 0.45
export const FAB_SETTLE_VEL = 10

/** Liquid squash from drag velocity (axis-aligned; no glyph rotation) */
export const SQUASH_VEL_REF = 1400
export const SQUASH_STRETCH = 1.18
export const SQUASH_COMPRESS = 0.82

/** Critically damped-ish sheet pull settle (ζ ≈ 1): c ≈ 2√k */
export const SHEET_SPRING_K = 145
export const SHEET_SPRING_C = 24
export const SHEET_SETTLE_POS = 0.5
export const SHEET_SETTLE_VEL = 6

/** Soft rubber past extents (~0.2 feel) — used at top / extremes only */
export const RUBBER_FACTOR = 0.2

/**
 * Two-stage sheet snap (page ↔ compact ↔ off-screen).
 * Distance gates use max(minPx, height × frac). Minimize zone is intentionally
 * wide so a normal pull lands on compact instead of hair-trigger dismiss —
 * only a clear past-dismiss distance or a hard flick closes from page.
 */
/** Page → compact on release past this (or soft flick down). */
export const SHEET_MINIMIZE_FRAC = 0.14
export const SHEET_MINIMIZE_MIN_PX = 56
/** Page/compact → dismiss past this (must sit well above minimize). */
export const SHEET_DISMISS_FRAC = 0.58
export const SHEET_DISMISS_MIN_PX = 260
/** Compact → page on pull-up past this. */
export const SHEET_EXPAND_FRAC = 0.18
export const SHEET_EXPAND_MIN_PX = 64
/** Soft flick (px/s): minimize from page, dismiss from compact, expand upward. */
export const SHEET_FLICK_VY = 720
/** Hard flick (px/s): skip minimize and dismiss from page. */
export const SHEET_DISMISS_FLICK_VY = 1750

export function sheetMinimizeThreshold(height: number): number {
  return Math.max(SHEET_MINIMIZE_MIN_PX, height * SHEET_MINIMIZE_FRAC)
}

export function sheetDismissThreshold(height: number): number {
  return Math.max(SHEET_DISMISS_MIN_PX, height * SHEET_DISMISS_FRAC)
}

export function sheetExpandThreshold(height: number): number {
  return Math.max(SHEET_EXPAND_MIN_PX, Math.min(120, height * SHEET_EXPAND_FRAC))
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

/** Axis-aligned squash/stretch from velocity. Icon stays upright. */
export function squashFromVelocity(
  vx: number,
  vy: number,
): { sx: number; sy: number } {
  const speed = Math.hypot(vx, vy)
  if (speed < 40) return { sx: 1, sy: 1 }
  const t = clamp(speed / SQUASH_VEL_REF, 0, 1)
  const ax = Math.abs(vx) / speed
  const ay = Math.abs(vy) / speed
  const stretch = 1 + (SQUASH_STRETCH - 1) * t
  const compress = 1 - (1 - SQUASH_COMPRESS) * t
  const sx = clamp(stretch * ax + compress * ay, SQUASH_COMPRESS, SQUASH_STRETCH)
  const sy = clamp(stretch * ay + compress * ax, SQUASH_COMPRESS, SQUASH_STRETCH)
  return { sx, sy }
}

/** Soft elliptical radius for a droplet silhouette while squashed. */
export function dropletRadius(sx: number, sy: number): string {
  const rx = clamp(50 / sx, 38, 62)
  const ry = clamp(50 / sy, 38, 62)
  return `${ry}% / ${rx}%`
}

/**
 * Flick → dock with axis preference.
 * Mostly-horizontal: keep the release point's vertical half.
 * Mostly-vertical: keep the release point's horizontal half.
 * Both axes strong: pick the true diagonal from velocity signs.
 */
export function dockFromFlick(
  x: number,
  y: number,
  vx: number,
  vy: number,
  viewportW: number,
  viewportH: number,
): CoachDockId {
  const ax = Math.abs(vx)
  const ay = Math.abs(vy)
  const onRight = x >= viewportW / 2
  const onBottom = y >= viewportH / 2

  const horizDominant = ax >= ay * FLICK_AXIS_DOMINANCE
  const vertDominant = ay >= ax * FLICK_AXIS_DOMINANCE

  let preferLeft: boolean
  let preferBottom: boolean

  if (horizDominant) {
    preferLeft = vx < 0
    preferBottom = onBottom
  } else if (vertDominant) {
    preferBottom = vy > 0
    preferLeft = !onRight
  } else {
    preferLeft = vx < 0
    preferBottom = vy > 0
  }

  if (preferBottom) return preferLeft ? 'bl' : 'br'
  return preferLeft ? 'tl' : 'tr'
}

/** Read live translateY from a transitioning/animating element (for interrupt). */
export function readTranslateY(el: HTMLElement | null): number {
  if (!el) return 0
  try {
    const t = getComputedStyle(el).transform
    if (!t || t === 'none') return 0
    return new DOMMatrix(t).m42
  } catch {
    return 0
  }
}
