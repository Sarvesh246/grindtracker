import { summarizeReadiness, type ReadinessCheck } from './hrv'
import { daysBetween } from './load'
import { restingRespiration } from './respiration'
import type { DailyBody, LoadSession } from './types'

/**
 * Body signals: early signs of strain or illness, from last night against
 * your own usual nights. Never a diagnosis.
 *
 * What the research says, and what this copies:
 *   - Overnight resting heart rate is the strongest single signal. Stanford's
 *     real-time alerting (Alavi et al., Nature Medicine 2022) flags a night
 *     above your usual and alerts on successive nights; it caught ~80% of
 *     infections at or before symptoms, a median 3 days early.
 *   - HRV falls (Hirten et al., JMIR 2021: up to 7 days before diagnosis);
 *     breathing rate and skin temperature rise (Natarajan et al., npj Digit
 *     Med 2020; Oura cohorts).
 *   - Every signal also moves for alcohol, hard training, bad sleep or
 *     stress. So, like Apple's Vitals, a warning needs two or more signals
 *     out of range at once, or heart rate up two nights running; and the
 *     wording is "under strain", never "you are sick".
 *
 * Each signal is last night's value against the median of up to 28 nights
 * before it (at least 7), with a robust spread (1.4826 × MAD, floored so a
 * very steady history doesn't turn noise into alarms). "Off" means 2 spreads
 * in the bad direction, "far off" 3.
 *
 * The night is 00:00–06:00 local (buckets 0–23): asleep or still for most
 * people, and the same window every night.
 */

export type SignalKey = 'sleeping_hr' | 'night_stress' | 'bb_gain' | 'respiration' | 'overnight_hrv' | 'hrv_check' | 'temperature'
export type SignalLevel = 'learning' | 'clear' | 'mild' | 'strong'

export interface Signal {
  key: SignalKey
  label: string
  /** Last night's value, display-ready ("71 bpm"). */
  value: string
  /** The usual, display-ready ("58 bpm"). */
  usual: string
  /** Spreads from usual, positive = worse. */
  z: number
  off: boolean
  /** "4 bpm higher than usual". */
  phrase: string
}

export interface BodySignals {
  date: string
  level: SignalLevel
  /** Signals with a usual to compare against, worst first. */
  signals: Signal[]
  /** Nights of history the best-covered signal has (for "learning"). */
  nights: number
  /** Sleeping HR above usual this night and the one before. */
  hrTwoNights: boolean
  headline: string
  advice: string
  /** Up to ~20 characters, for the watch. */
  short: string | null
  /** Likely ordinary reasons for the strain, found in your own data. */
  explanations: string[]
  /** What you said this morning was, if you said. */
  labels: string[]
}

export interface SignalLabel {
  local_date: string
  tags: string[]
}

export interface SignalExtras {
  readiness?: ReadinessCheck[]
  sessions?: LoadSession[]
  labels?: SignalLabel[]
  /** Overnight HRV (ms) by wake date, from an imported sleep source. */
  overnightHrv?: Map<string, number>
}

const NIGHT = 24
const BASELINE_NIGHTS = 28
export const MIN_BASELINE_NIGHTS = 7
const OFF = 2
const FAR_OFF = 3

interface Spec {
  key: SignalKey
  label: string
  /** +1: higher is worse; −1: lower is worse. */
  worse: 1 | -1
  /** Smallest spread allowed, in the signal's units. */
  floor: number
  unit: string
  digits: number
  /** Only counts toward a warning when another signal is off. */
  weak?: boolean
}

const SPECS: Spec[] = [
  { key: 'sleeping_hr', label: 'Sleeping heart rate', worse: 1, floor: 2, unit: 'bpm', digits: 0 },
  { key: 'overnight_hrv', label: 'Overnight HRV', worse: -1, floor: 4, unit: 'ms', digits: 0 },
  { key: 'night_stress', label: 'Overnight stress', worse: 1, floor: 4, unit: '', digits: 0 },
  { key: 'bb_gain', label: 'Body Battery recharge', worse: -1, floor: 6, unit: 'pts', digits: 0 },
  { key: 'respiration', label: 'Breathing rate', worse: 1, floor: 0.5, unit: '/min', digits: 1 },
  { key: 'temperature', label: 'Wrist temperature', worse: 1, floor: 0.3, unit: '°C', digits: 1, weak: true },
]

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function nightValues(series: (number | null)[] | null | undefined, min: number): number[] | null {
  const v = (series ?? []).slice(0, NIGHT).filter((x): x is number => x != null)
  return v.length >= min ? v : null
}

function shiftDate(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Body Battery gained overnight: the morning peak (by 10:00) minus the
 *  lowest reading from 21:00 the evening before through 02:00. */
export function bbGain(row: DailyBody | undefined, prev: DailyBody | undefined): number | null {
  const s = row?.bb_series
  if (!s) return null
  const morning = s.slice(0, 40).filter((x): x is number => x != null)
  const low = [...(prev?.bb_series ?? []).slice(84, 96), ...s.slice(0, 8)].filter((x): x is number => x != null)
  if (morning.length < 8 || !low.length) return null
  return Math.max(...morning) - Math.min(...low)
}

/** One night's raw value for each signal, or null where the watch had too
 *  little of that night. */
export function nightOf(days: Map<string, DailyBody>, date: string, extras: SignalExtras = {}): Partial<Record<SignalKey, number>> {
  const row = days.get(date)
  const out: Partial<Record<SignalKey, number>> = {}
  const hr = nightValues(row?.hr_series, 12)
  if (hr) out.sleeping_hr = median(hr)
  const st = nightValues(row?.stress_series, 12)
  if (st) out.night_stress = st.reduce((a, b) => a + b, 0) / st.length
  const gain = bbGain(row, days.get(shiftDate(date, -1)))
  if (gain != null) out.bb_gain = gain
  const resp = restingRespiration(row)
  if (resp != null) out.respiration = resp
  const temp = nightValues(row?.temp_series, 8)
  if (temp) out.temperature = median(temp) / 10
  const hrv = extras.overnightHrv?.get(date)
  if (hrv != null) out.overnight_hrv = hrv
  return out
}

function fmt(v: number, digits: number, unit: string): string {
  const n = digits ? (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits) : String(Math.round(v))
  return unit ? (unit.startsWith('/') || unit.startsWith('°') ? `${n}${unit}` : `${n} ${unit}`) : n
}

function phraseFor(spec: Spec, diff: number): string {
  const amount = fmt(Math.abs(diff), spec.digits, spec.unit)
  switch (spec.key) {
    case 'bb_gain':
      return diff < 0 ? `Body Battery recharged ${amount} less than usual` : `Body Battery recharged ${amount} more than usual`
    case 'night_stress':
      return diff > 0 ? `overnight stress ran ${amount} higher than usual` : 'overnight stress was lower than usual'
    default:
      return `${spec.label.toLowerCase()} was ${amount} ${diff > 0 ? 'higher' : 'lower'} than usual`
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Ordinary reasons for overnight strain found in the data: a long or hard
 *  session the day before, or what you already said about the morning. */
function explain(date: string, extras: SignalExtras): string[] {
  const out: string[] = []
  const yesterday = shiftDate(date, -1)
  for (const s of extras.sessions ?? []) {
    if (s.local_date !== yesterday && s.local_date !== date) continue
    const hard = (s.zone_seconds?.[3] ?? 0) + (s.zone_seconds?.[4] ?? 0)
    const mins = s.started_at && s.completed_at ? (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 60_000 : 0
    if (s.local_date === yesterday && (hard >= 15 * 60 || mins >= 90)) {
      out.push(hard >= 15 * 60 ? `${Math.round(hard / 60)} min in zones 4–5 yesterday` : `a ${Math.round(mins)}-minute session yesterday`)
      break
    }
  }
  return out
}

const LABEL_TEXT: Record<string, string> = {
  sick: 'you felt sick',
  alcohol: 'you had a drink',
  poor_sleep: 'you slept badly',
  hard_training: 'you trained hard',
  stress: 'it was a stressful day',
  travel: 'you were travelling',
  fine: 'you felt fine',
}

export function labelText(tag: string): string {
  return LABEL_TEXT[tag] ?? tag
}

export function computeSignals(daysList: DailyBody[], date: string, extras: SignalExtras = {}): BodySignals {
  const days = new Map(daysList.map(d => [d.local_date, d]))
  const tonight = nightOf(days, date, extras)
  const history: Partial<Record<SignalKey, number>>[] = []
  for (let i = 1; i <= BASELINE_NIGHTS; i++) history.push(nightOf(days, shiftDate(date, -i), extras))

  const signals: Signal[] = []
  let nights = 0
  for (const spec of SPECS) {
    const prior = history.map(h => h[spec.key]).filter((v): v is number => v != null)
    nights = Math.max(nights, prior.length)
    const now = tonight[spec.key]
    if (now == null || prior.length < MIN_BASELINE_NIGHTS) continue
    const center = median(prior)
    const spread = Math.max(spec.floor, 1.4826 * median(prior.map(v => Math.abs(v - center))))
    const z = (spec.worse * (now - center)) / spread
    signals.push({
      key: spec.key,
      label: spec.label,
      value: fmt(now, spec.digits, spec.unit),
      usual: fmt(center, spec.digits, spec.unit),
      z: Math.round(z * 10) / 10,
      off: z >= OFF,
      phrase: phraseFor(spec, now - center),
    })
  }

  // The morning HRV check carries its own usual (hrv.ts, 5 mornings).
  const r = extras.readiness?.length ? summarizeReadiness(extras.readiness, date) : null
  if (r?.today && r.z != null && r.baseline) {
    const z = -r.z
    signals.push({
      key: 'hrv_check',
      label: 'Morning HRV check',
      value: `${Math.round(r.today.rmssd)} ms`,
      usual: `${r.baseline.lowMs}–${r.baseline.highMs} ms`,
      z: Math.round(z * 10) / 10,
      off: z >= OFF,
      phrase: z > 0 ? `this morning's HRV is under your usual ${r.baseline.lowMs}–${r.baseline.highMs} ms` : "this morning's HRV is in your usual range",
    })
  }

  signals.sort((a, b) => b.z - a.z)
  const weakKeys = new Set(SPECS.filter(s => s.weak).map(s => s.key))
  const strongOff = signals.filter(s => s.off && !weakKeys.has(s.key))
  const off = strongOff.length + (strongOff.length ? signals.filter(s => s.off && weakKeys.has(s.key)).length : 0)
  const farOff = strongOff.some(s => s.z >= FAR_OFF)

  // NightSignal's rule: sleeping HR above usual on two successive nights.
  const hrNow = signals.find(s => s.key === 'sleeping_hr')
  let hrTwoNights = false
  if (hrNow?.off) {
    const prev = computeSignalOne(days, shiftDate(date, -1), 'sleeping_hr', extras)
    hrTwoNights = prev != null && prev >= OFF
  }

  const labels = (extras.labels ?? []).find(l => l.local_date === date)?.tags ?? []
  const explanations = explain(date, extras)

  let level: SignalLevel
  if (signals.length < 2) level = 'learning'
  else if (off >= 3 || (off >= 2 && farOff) || (hrTwoNights && off >= 2)) level = 'strong'
  else if (off >= 2 || hrTwoNights) level = 'mild'
  else level = 'clear'

  const offPhrases = signals.filter(s => s.off).map(s => s.phrase)
  let headline: string
  let advice: string
  let short: string | null = null
  if (level === 'learning') {
    headline = 'Learning your usual nights'
    advice = `Body signals start after ${MIN_BASELINE_NIGHTS} nights of wearing the watch to bed (${Math.min(nights, MIN_BASELINE_NIGHTS)} so far).`
  } else if (level === 'clear') {
    headline = 'Nothing unusual overnight'
    advice = signals.some(s => s.off)
      ? `${capitalize(offPhrases[0])}, but nothing else moved with it.`
      : 'Your overnight numbers are in your usual range.'
  } else if (level === 'mild') {
    headline = 'Your body is under some strain'
    advice = `${capitalize(offPhrases.slice(0, 2).join(' and '))}. Go easier today and get to bed early.`
    short = 'Signs of strain'
  } else {
    headline = 'Strong signs your body is fighting something'
    advice = `${capitalize(offPhrases.slice(0, 2).join(' and '))}${offPhrases.length > 2 ? `, and ${offPhrases.length - 2} more` : ''}. This pattern often comes a day or two before getting sick: rest, hydrate and skip hard training today.`
    short = 'Rest: strain signs'
  }
  if (level !== 'learning' && level !== 'clear' && explanations.length) {
    advice += ` It could also be ${explanations.join(' or ')}.`
  }
  if (labels.length) advice += ` You noted ${labels.map(labelText).join(', ')}.`

  return { date, level, signals, nights, hrTwoNights, headline, advice, short, explanations, labels }
}

function computeSignalOne(days: Map<string, DailyBody>, date: string, key: SignalKey, extras: SignalExtras): number | null {
  const spec = SPECS.find(s => s.key === key)!
  const now = nightOf(days, date, extras)[key]
  if (now == null) return null
  const prior: number[] = []
  for (let i = 1; i <= BASELINE_NIGHTS; i++) {
    const v = nightOf(days, shiftDate(date, -i), extras)[key]
    if (v != null) prior.push(v)
  }
  if (prior.length < MIN_BASELINE_NIGHTS) return null
  const center = median(prior)
  const spread = Math.max(spec.floor, 1.4826 * median(prior.map(v => Math.abs(v - center))))
  return (spec.worse * (now - center)) / spread
}

/** How often the warnings were right: flagged mornings you labelled, and
 *  how many of those you said you were sick within two days. */
export function signalTrackRecord(daysList: DailyBody[], until: string, extras: SignalExtras = {}): { flagged: number; labelled: number; sick: number } {
  let flagged = 0, labelled = 0, sick = 0
  const labels = new Map((extras.labels ?? []).map(l => [l.local_date, l.tags]))
  for (let i = 0; i < 90; i++) {
    const date = shiftDate(until, -i)
    if (daysBetween(date, until) > 90) break
    const s = computeSignals(daysList, date, extras)
    if (s.level !== 'mild' && s.level !== 'strong') continue
    flagged++
    const around = [date, shiftDate(date, 1), shiftDate(date, 2)].map(d => labels.get(d) ?? [])
    if (around.some(t => t.length)) labelled++
    if (around.some(t => t.includes('sick'))) sick++
  }
  return { flagged, labelled, sick }
}
