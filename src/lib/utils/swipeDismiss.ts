/** Distance (px) in any direction that commits a swipe-to-dismiss. */
export const SWIPE_DISMISS_PX = 40
/** Shorter travel that still dismisses when the flick is fast enough. */
export const SWIPE_FLICK_PX = 18
/** Minimum speed (px/ms) for the short-flick path. ~180px over 400ms. */
export const SWIPE_FLICK_VELOCITY = 0.45
/** How far the pill flies off-screen after a committed swipe. */
export const SWIPE_FLY_PX = 520

/**
 * Left, right, up, or down past the distance threshold — or a quicker flick
 * covering less ground — dismisses. Tiny wobble stays a no-op so a tap on
 * UNDO / Dismiss still counts as a click.
 */
export function swipeShouldDismiss(dx: number, dy: number, dtMs: number): boolean {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax >= SWIPE_DISMISS_PX || ay >= SWIPE_DISMISS_PX) return true
  const dist = Math.hypot(dx, dy)
  const dt = Math.max(dtMs, 1)
  return dist >= SWIPE_FLICK_PX && dist / dt >= SWIPE_FLICK_VELOCITY
}

/** Project the drag vector out to `distance` so the pill leaves the viewport. */
export function swipeFlyOff(
  dx: number,
  dy: number,
  distance = SWIPE_FLY_PX,
): { x: number; y: number } {
  const mag = Math.hypot(dx, dy)
  if (mag < 1) return { x: 0, y: -distance }
  const scale = distance / mag
  return { x: dx * scale, y: dy * scale }
}
