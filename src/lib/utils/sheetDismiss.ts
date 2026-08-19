/** Downward drag (px) that commits a bottom-sheet dismiss. */
export const SHEET_DISMISS_PX = 88
/** Faster flick (px/ms) that dismisses with less travel. ~65px over 100ms. */
export const SHEET_DISMISS_VELOCITY = 0.65
/** Minimum downward travel before a flick can count. */
export const SHEET_DISMISS_FLICK_PX = 24

/**
 * Bottom-sheet swipe-down: commit after enough travel, or a quicker flick
 * covering less ground. Upward / tiny wobble stays a no-op so header buttons
 * still receive the click.
 */
export function sheetShouldDismiss(dy: number, velocityY: number): boolean {
  if (dy < SHEET_DISMISS_FLICK_PX) return false
  if (dy >= SHEET_DISMISS_PX) return true
  return velocityY >= SHEET_DISMISS_VELOCITY
}
