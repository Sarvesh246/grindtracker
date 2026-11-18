/**
 * Morning readiness check: heart-rate variability from one minute of
 * beat-to-beat intervals the watch records while you sit still.
 *
 * The method follows the short-recording practice HRV4Training and Elite HRV
 * validated against ECG (Plews et al. 2017; Esco & Flatt 2014): RMSSD from a
 * 60 s window after a settle period, compared on the natural-log scale with
 * your own rolling baseline, never with population norms.
 *
 *   1. Intervals outside 300–2000 ms (30–200 bpm) are artifacts.
 *   2. An interval more than 20% away from the median of its 11 neighbours is
 *      an artifact (a missed or doubled beat). Wrist optical sensors produce
 *      these whenever a finger twitches.
 *   3. RMSSD uses only successive differences where BOTH beats are clean and
 *      adjacent, so a removed beat never fakes a large difference.
 *   4. Quality: good needs 40+ clean pairs, under 10% artifacts and under
 *      5 s of movement; fair allows 30 pairs and 20%; anything else is poor
 *      and never reaches Charge or the baseline.
 *
 * The watch runs the same steps for its result screen (Readiness.mc); this
 * module is authoritative and recomputes from the raw intervals on upload.
 */

import { clamp } from './load'

export const MIN_RR = 300
export const MAX_RR = 2000
const NEIGHBOURS = 5          // each side
const MAX_DEVIATION = 0.2

export type HrvQuality = 'good' | 'fair' | 'poor'

export interface HrvResult {
  rmssd: number | null
  lnRmssd: number | null
  meanHr: number | null
  sdnn: number | null
  cleanBeats: number
  cleanPairs: number
  artifactPct: number
  quality: HrvQuality
  /** Why a poor reading is poor, for the watch and the logs. */
  reason: string | null
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** True for each interval that survives both artifact rules. */
export function cleanMask(rr: number[]): boolean[] {
  const inRange = rr.map(v => Number.isFinite(v) && v >= MIN_RR && v <= MAX_RR)
  return rr.map((v, i) => {
    if (!inRange[i]) return false
    const around: number[] = []
    for (let j = Math.max(0, i - NEIGHBOURS); j <= Math.min(rr.length - 1, i + NEIGHBOURS); j++) {
      if (j !== i && inRange[j]) around.push(rr[j])
    }
    if (around.length < 4) return true
    const m = median(around)
    return Math.abs(v - m) <= MAX_DEVIATION * m
  })
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d

export function analyzeRr(rr: number[], movingSeconds = 0): HrvResult {
  const mask = cleanMask(rr)
  const clean = rr.filter((_, i) => mask[i])
  let sum2 = 0
  let pairs = 0
  for (let i = 1; i < rr.length; i++) {
    if (mask[i] && mask[i - 1]) {
      const d = rr[i] - rr[i - 1]
      sum2 += d * d
      pairs++
    }
  }
  const artifactPct = rr.length ? round((100 * (rr.length - clean.length)) / rr.length, 1) : 100
  const mean = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null
  const sdnn = mean != null && clean.length > 1
    ? Math.sqrt(clean.reduce((a, b) => a + (b - mean) ** 2, 0) / (clean.length - 1))
    : null
  const rmssd = pairs > 0 ? Math.sqrt(sum2 / pairs) : null

  let quality: HrvQuality = 'poor'
  let reason: string | null = null
  if (pairs >= 40 && artifactPct <= 10 && movingSeconds < 5) quality = 'good'
  else if (pairs >= 30 && artifactPct <= 20 && movingSeconds < 10) quality = 'fair'
  else reason = movingSeconds >= 10 ? 'moving' : pairs < 30 ? 'too few beats' : 'too many artifacts'
  if (rmssd != null && rmssd < 1) { quality = 'poor'; reason = 'flat signal' }

  return {
    rmssd: rmssd == null ? null : round(rmssd, 1),
    lnRmssd: rmssd == null || rmssd < 1 ? null : round(Math.log(rmssd), 3),
    meanHr: mean == null ? null : round(60000 / mean, 1),
    sdnn: sdnn == null ? null : round(sdnn, 1),
    cleanBeats: clean.length,
    cleanPairs: pairs,
    artifactPct,
    quality,
    reason,
  }
}

/** One stored check (migration 68's readiness_checks row, the parts we use). */
export interface ReadinessCheck {
  local_date: string
  measured_at: string
  rmssd: number | null
  ln_rmssd: number | null
  mean_hr: number | null
  quality: HrvQuality
}

export type ReadinessStatus = 'below' | 'within' | 'above'

export interface ReadinessSummary {
  /** Today's reading, or null before the day's first usable check. */
  today: { rmssd: number; meanHr: number | null; quality: HrvQuality; measuredAt: string } | null
  /** From the 60 days before today: one reading per day (the first usable). */
  baseline: { meanMs: number; lowMs: number; highMs: number; days: number } | null
  /** Today vs baseline in baseline standard deviations (log scale). */
  z: number | null
  status: ReadinessStatus | null
  /** 7-day average against the baseline: the trend that matters more than one morning. */
  weekZ: number | null
}

export const BASELINE_DAYS = 60
export const MIN_BASELINE_READINGS = 5
/** On the log scale: a day-to-day SD below this is a too-short history, not a calm body. */
const SD_FLOOR = 0.06
/** The usual range shown to you: mean ± 1 SD (log scale), Plews' "normal range". */
const RANGE_SD = 1

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00`) - Date.parse(`${from}T12:00:00`)) / 86_400_000)
}

/** The first usable check of each day, by measured time. */
export function dailyReadings(checks: ReadinessCheck[]): Map<string, ReadinessCheck> {
  const out = new Map<string, ReadinessCheck>()
  for (const c of [...checks].sort((a, b) => a.measured_at.localeCompare(b.measured_at))) {
    if (c.quality === 'poor' || c.ln_rmssd == null || c.rmssd == null) continue
    if (!out.has(c.local_date)) out.set(c.local_date, c)
  }
  return out
}

export function summarizeReadiness(checks: ReadinessCheck[], today: string): ReadinessSummary {
  const days = dailyReadings(checks)
  const t = days.get(today) ?? null
  const prior = [...days.values()].filter(c => c.local_date < today && daysBetween(c.local_date, today) <= BASELINE_DAYS)
  let baseline: ReadinessSummary['baseline'] = null
  let mean = 0
  let sd = 0
  if (prior.length >= MIN_BASELINE_READINGS) {
    const ln = prior.map(c => c.ln_rmssd as number)
    mean = ln.reduce((a, b) => a + b, 0) / ln.length
    sd = Math.max(SD_FLOOR, Math.sqrt(ln.reduce((a, b) => a + (b - mean) ** 2, 0) / (ln.length - 1)))
    baseline = {
      meanMs: round(Math.exp(mean), 1),
      lowMs: Math.round(Math.exp(mean - RANGE_SD * sd)),
      highMs: Math.round(Math.exp(mean + RANGE_SD * sd)),
      days: prior.length,
    }
  }
  const z = t && baseline ? round(((t.ln_rmssd as number) - mean) / sd, 2) : null
  const week = [...days.values()].filter(c => c.local_date <= today && daysBetween(c.local_date, today) < 7)
  const weekZ = baseline && week.length >= 3
    ? round((week.reduce((a, c) => a + (c.ln_rmssd as number), 0) / week.length - mean) / sd, 2)
    : null
  return {
    today: t ? { rmssd: t.rmssd as number, meanHr: t.mean_hr, quality: t.quality, measuredAt: t.measured_at } : null,
    baseline,
    z,
    status: z == null ? null : z < -RANGE_SD ? 'below' : z > RANGE_SD ? 'above' : 'within',
    weekZ,
  }
}

/** Charge's 0–100 for HRV: full marks at or above your usual, falling ~30 a
 *  standard deviation below it. A reading far above usual is not penalised:
 *  on its own it is far more often a good night than a warning sign. */
export function hrvScore(z: number): number {
  return Math.round(clamp(90 + 30 * z, 0, 100))
}
