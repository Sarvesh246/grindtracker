/**
 * Coach motion helpers — RAF springs + CSS (no Framer Motion / motion dep).
 * Tuned for Apple-like feel: high-stiffness docks, critically damped sheet
 * settles, velocity squash without rotating the G glyph.
 */

/** Flick threshold (px/s) — above this, dock by flick direction */
export const FLICK_VELOCITY_PX_S = 500

/** FAB settle spring — high stiffness, moderate damping (shoot then catch) */
export const FAB_SPRING_K = 380
export const FAB_SPRING_C = 34
export const FAB_SPRING_VEL_CARRY = 0.55
export const FAB_SPRING_VEL_CARRY_FLICK = 0.72
export const FAB_SETTLE_POS = 0.4
export const FAB_SETTLE_VEL = 12

/** Liquid squash from drag velocity (axis-aligned; no glyph rotation) */
export const SQUASH_VEL_REF = 1400
export const SQUASH_STRETCH = 1.18
export const SQUASH_COMPRESS = 0.82

/** Critically damped-ish sheet pull settle (ζ ≈ 1): c ≈ 2√k */
export const SHEET_SPRING_K = 240
export const SHEET_SPRING_C = 31
export const SHEET_SETTLE_POS = 0.5
export const SHEET_SETTLE_VEL = 8

/** Soft rubber past extents (~0.2 feel) */
export const RUBBER_FACTOR = 0.2

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
