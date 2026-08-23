/**
 * How a running (or paused) rest countdown reacts to a new default.
 *
 * Changing the session/exercise default must never restart the clock at the
 * full new length — that was the bug: 38s left of a 90s rest, pick 60s,
 * jumped back to 0:60. Remaining time is preserved unless it no longer fits
 * the new default (then it clamps down). A rest that has barely started
 * (finger still on the presets) snaps to the new full length so picking
 * 90 → 180 right after a set actually gives you 180.
 */

/** Elapsed time under this is "just started" — snap to the new default. */
export const REST_DEFAULT_FRESH_MS = 1000

export type RestDefaultChangeInput = {
  remainingMs: number
  durationMs: number
  newDefaultSec: number
  now: number
  startedAt: number
  paused: boolean
}

export type RestDefaultChangeResult = {
  remainingMs: number
  durationMs: number
  startedAt: number
}

function liveRemaining(input: RestDefaultChangeInput): number {
  if (input.paused) return Math.max(0, input.remainingMs)
  return Math.max(0, input.durationMs - (input.now - input.startedAt))
}

/**
 * Remaining ms after a default change.
 * - Preserve remaining when it still fits the new default (38→60 stays 38;
 *   58→60 stays 58).
 * - Clamp down when remaining is longer than the new default (70→60 becomes 60).
 * - Never increase remaining on a rest that's already underway.
 * - Snap to the new full length only when the rest has barely started.
 */
export function remainingAfterRestDefaultChange(
  remainingMs: number,
  durationMs: number,
  newDefaultSec: number,
): number {
  const newDuration = Math.round(newDefaultSec * 1000)
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0
  if (!Number.isFinite(newDuration) || newDuration <= 0) return remainingMs
  const elapsed = Math.max(0, durationMs - remainingMs)
  if (elapsed < REST_DEFAULT_FRESH_MS) return newDuration
  return Math.min(remainingMs, newDuration)
}

export function applyRestDefaultChange(
  input: RestDefaultChangeInput,
): RestDefaultChangeResult | null {
  const newDuration = Math.round(input.newDefaultSec * 1000)
  if (!Number.isFinite(newDuration) || newDuration <= 0) return null

  const remainingNow = liveRemaining(input)
  if (remainingNow <= 0) return null

  const remainingMs = remainingAfterRestDefaultChange(
    remainingNow,
    input.durationMs,
    input.newDefaultSec,
  )

  // Paused: remainingMs is the source of truth; startedAt is rebuilt on resume.
  // Running: rebase startedAt so duration − elapsed = remaining (progress bar
  // uses remaining/duration, so duration becomes the new default).
  const startedAt = input.paused
    ? input.startedAt
    : input.now - (newDuration - remainingMs)

  return { remainingMs, durationMs: newDuration, startedAt }
}
