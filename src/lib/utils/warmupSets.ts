/**
 * Suggest warm-up set weights as fractions of a working-set load (canonical lbs).
 * Defaults match a common 40/60/80% ramp into the first working set.
 */
export function warmupRampWeights(
  workingLbs: number,
  fractions: number[] = [0.4, 0.6, 0.8],
): number[] {
  if (!Number.isFinite(workingLbs) || workingLbs <= 0) return []
  return fractions
    .filter(f => Number.isFinite(f) && f > 0 && f < 1)
    .map(f => Math.round(workingLbs * f * 2) / 2) // nearest 0.5 lb
}

/** Round a display-unit weight to a sensible plate-friendly step. */
export function roundToStep(value: number, step = 2.5): number {
  if (!Number.isFinite(value) || step <= 0) return value
  return Math.round(value / step) * step
}
