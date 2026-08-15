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

export type WarmupRampSet = {
  setNumber: number
  weight: string
  isWarmup: boolean
  checked: boolean
  skipped: boolean
}

export function parseSetWeight(raw: string): number | null {
  if (!raw || raw.trim() === '') return null
  const n = parseFloat(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Last non-warmup, non-skipped positive weight; else previous best. */
export function workingWeightForRamp(
  sets: WarmupRampSet[],
  previousBest: number | null | undefined,
): number | null {
  for (let i = sets.length - 1; i >= 0; i--) {
    const s = sets[i]
    if (s.skipped || s.isWarmup) continue
    const w = parseSetWeight(s.weight)
    if (w != null) return w
  }
  if (previousBest != null && previousBest > 0) return previousBest
  return null
}

export type WarmupRampPlan =
  | {
      ok: true
      working: number
      extraToAdd: number
      fillWeight: string
      updates: { setNumber: number; weight: number }[]
    }
  | { ok: false; reason: 'no-weight' | 'nothing-to-fill' }

function setAt(sets: WarmupRampSet[], n: number): WarmupRampSet | undefined {
  return sets.find(s => s.setNumber === n)
}

/**
 * Plan a 40/60/80% warm-up ramp that sits in front of working sets.
 * Adds extra slots when needed so converting the first three sets does not
 * eat the planned working work. Does not overwrite checked or skipped sets.
 */
export function planWarmupRamp(
  sets: WarmupRampSet[],
  setsTarget: number,
  previousBest: number | null | undefined,
  fractions: number[] = [0.4, 0.6, 0.8],
): WarmupRampPlan {
  const working = workingWeightForRamp(sets, previousBest)
  if (working == null) return { ok: false, reason: 'no-weight' }

  const ramp = warmupRampWeights(working, fractions)
  if (ramp.length === 0) return { ok: false, reason: 'no-weight' }

  const total = sets.length
  const leadingNums = ramp.map((_, i) => i + 1)
  const leading = leadingNums.map(n => setAt(sets, n))
  const locked = leading.some(s => s && (s.checked || s.skipped))
  const alreadyRamped =
    leading.every(s => s && s.isWarmup && !s.checked && !s.skipped) &&
    total >= setsTarget + ramp.length

  if (locked) {
    const updates = ramp.flatMap((weight, i) => {
      const s = leading[i]
      if (!s || s.checked || s.skipped) return []
      if (!s.isWarmup && parseSetWeight(s.weight) != null) return []
      return [{ setNumber: i + 1, weight }]
    })
    if (updates.length === 0) return { ok: false, reason: 'nothing-to-fill' }
    return { ok: true, working, extraToAdd: 0, fillWeight: String(working), updates }
  }

  const extraToAdd = alreadyRamped ? 0 : Math.max(0, setsTarget + ramp.length - total)
  const updates = ramp.map((weight, i) => ({ setNumber: i + 1, weight }))
  return { ok: true, working, extraToAdd, fillWeight: String(working), updates }
}
