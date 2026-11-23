import { summarizeReadiness, type ReadinessCheck } from './hrv'
import { restingRespiration } from './respiration'
import { durationShort, shiftDate } from '@/lib/health/model'
import type { RecoveryNight } from './sleep'
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
 * before it (at least 7, or 3 for preliminary sleeping heart rate), with a robust spread (1.4826 × MAD, floored so a
 * very steady history doesn't turn noise into alarms). "Off" means 2 spreads
 * in the bad direction, "far off" 3.
 *
 * Use recorded sleep intervals when available; midnight to 06:00 is the
 * fallback for dates with no imported sleep. Compare like windows.
 */

export type SignalKey = 'sleeping_hr' | 'night_stress' | 'bb_gain' | 'respiration' | 'overnight_hrv' | 'hrv_check' | 'temperature' | 'sleep_duration' | 'sleep_efficiency'
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
  baselineNights?: number
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
  overnightHrv?: ReadonlyMap<string, number>
  nights?: ReadonlyMap<string, RecoveryNight>
}

const NIGHT = 24
const BASELINE_NIGHTS = 28
export const MIN_BASELINE_NIGHTS = 7
const OFF = 2
const FAR_OFF = 3
const MIN_PRELIMINARY_HR_NIGHTS = 3

interface Spec {
  key: SignalKey
  label: string
  /** +1: higher is worse; −1: lower is worse. */
  worse: 1 | -1
  /** Smallest spread allowed, in the signal's units. */
  floor: number
  unit: string
  digits: number
  group?: 'sleep' | 'autonomic'
}

const SPECS: Spec[] = [
  { key: 'sleeping_hr', label: 'Sleeping heart rate', worse: 1, floor: 2, unit: 'bpm', digits: 0 },
  { key: 'overnight_hrv', label: 'Overnight HRV', worse: -1, floor: 4, unit: 'ms', digits: 0, group: 'autonomic' },
  { key: 'night_stress', label: 'Overnight stress', worse: 1, floor: 4, unit: '', digits: 0, group: 'autonomic' },
  { key: 'bb_gain', label: 'Body Battery recharge', worse: -1, floor: 6, unit: 'pts', digits: 0, group: 'autonomic' },
  { key: 'respiration', label: 'Breathing rate', worse: 1, floor: 0.5, unit: '/min', digits: 1 },
  { key: 'temperature', label: 'Wrist temperature', worse: 1, floor: 0.3, unit: '°C', digits: 1 },
  { key: 'sleep_duration', label: 'Sleep duration', worse: -1, floor: 30, unit: 'min', digits: 0, group: 'sleep' },
  { key: 'sleep_efficiency', label: 'Time asleep', worse: -1, floor: 4, unit: '%', digits: 0, group: 'sleep' },
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

type NightSeries = 'hr_series' | 'stress_series' | 'resp_series' | 'temp_series' | 'bb_series'

function duringSleep(days: Map<string, DailyBody>, date: string, night: RecoveryNight, field: NightSeries, min: number) {
  const values: number[] = []
  let possible = 0
  const first = Math.floor(night.start * 4)
  const last = Math.ceil(night.end * 4)
  const rows = new Map<number, DailyBody | undefined>()
  for (let b = first; b < last; b++) {
    const center = (b + 0.5) / 4
    if (!night.asleep.some(s => center >= s.start && center < s.end)) continue
    possible++
    const day = Math.floor(b / 96)
    if (!rows.has(day)) rows.set(day, days.get(shiftDate(date, day)))
    const v = rows.get(day)?.[field]?.[b - day * 96]
    if (v != null && Number.isFinite(v)) values.push(v)
  }
  return values.length >= Math.max(min, Math.ceil(possible / 2)) ? values : null
}

/** One night's raw value for each signal, or absent with inadequate coverage. */
export function nightOf(days: Map<string, DailyBody>, date: string, extras: SignalExtras = {}): Partial<Record<SignalKey, number>> {
  const row = days.get(date)
  const night = extras.nights?.get(date)
  const out: Partial<Record<SignalKey, number>> = {}
  const sample = (field: NightSeries, min: number) =>
    night ? duringSleep(days, date, night, field, min) : nightValues(row?.[field], min)
  const hr = sample('hr_series', night ? 8 : 12)
  if (hr) out.sleeping_hr = median(hr)
  const st = sample('stress_series', night ? 8 : 12)
  if (st) out.night_stress = st.reduce((a, b) => a + b, 0) / st.length
  const bb = night && sample('bb_series', 8)
  const gain = night ? (bb && bb[bb.length - 1] - bb[0]) : bbGain(row, days.get(shiftDate(date, -1)))
  if (gain != null) out.bb_gain = gain
  const breathing = night ? sample('resp_series', 8) : null
  const resp = night ? (breathing && median(breathing)) : restingRespiration(row)
  if (resp != null) out.respiration = resp
  const temp = sample('temp_series', 8)
  if (temp) out.temperature = median(temp) / 10
  const hrv = night?.hrv ?? extras.overnightHrv?.get(date)
  if (typeof hrv === 'number' && Number.isFinite(hrv) && hrv > 0) out.overnight_hrv = hrv
  if (night) {
    out.sleep_duration = night.minutes
    out.sleep_efficiency = night.efficiency
  }
  return out
}

const WINDOW_KEYS = new Set<SignalKey>(['sleeping_hr', 'night_stress', 'bb_gain', 'respiration', 'temperature'])

function fmt(v: number, digits: number, unit: string): string {
  const n = digits ? (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits) : String(Math.round(v))
  return unit ? (unit.startsWith('/') || unit.startsWith('°') ? `${n}${unit}` : `${n} ${unit}`) : n
}

function phraseFor(spec: Spec, diff: number): string {
  const amount = fmt(Math.abs(diff), spec.digits, spec.unit)
  switch (spec.key) {
    case 'sleep_duration':
      return `you slept ${durationShort(Math.abs(diff) * 60)} ${diff < 0 ? 'less' : 'more'} than usual`
    case 'sleep_efficiency':
      return diff < 0 ? 'you spent more time awake during sleep than usual' : 'you spent less time awake during sleep than usual'
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
  return signalsFor(date, extras, day => nightOf(days, day, extras))
}

type NightLookup = (date: string) => ReturnType<typeof nightOf>

function signalsFor(date: string, extras: SignalExtras, lookup: NightLookup): BodySignals {
  const tonight = lookup(date)
  const history = Array.from({ length: BASELINE_NIGHTS }, (_, i) => {
    const prior = shiftDate(date, -i - 1)
    return { values: lookup(prior), aligned: extras.nights?.has(prior) ?? false }
  })
  const aligned = extras.nights?.has(date) ?? false

  const signals: Signal[] = []
  let nights = 0
  for (const spec of SPECS) {
    const prior = history
      .filter(h => !WINDOW_KEYS.has(spec.key) || h.aligned === aligned)
      .map(h => h.values[spec.key])
      .filter((v): v is number => v != null)
    nights = Math.max(nights, prior.length)
    const now = tonight[spec.key]
    const preliminary = spec.key === 'sleeping_hr' && aligned
      && prior.length >= MIN_PRELIMINARY_HR_NIGHTS && prior.length < MIN_BASELINE_NIGHTS
    if (now == null || (!preliminary && prior.length < MIN_BASELINE_NIGHTS)) continue
    const center = median(prior)
    // With a short reference window, require at least 6 bpm before marking HR off.
    const floor = preliminary ? 3 : spec.floor
    const spread = Math.max(floor, 1.4826 * median(prior.map(v => Math.abs(v - center))))
    const z = (spec.worse * (now - center)) / spread
    signals.push({
      key: spec.key,
      label: spec.label,
      value: spec.key === 'sleep_duration' ? durationShort(now * 60) : fmt(now, spec.digits, spec.unit),
      usual: spec.key === 'sleep_duration' ? durationShort(center * 60) : fmt(center, spec.digits, spec.unit),
      z: Math.round(z * 10) / 10,
      off: z >= OFF,
      baselineNights: preliminary ? prior.length : undefined,
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
  const groupOf = (s: Signal) => s.key === 'hrv_check' ? 'autonomic' : SPECS.find(spec => spec.key === s.key)?.group ?? s.key
  const flagged = signals.filter(s => s.off)
  const physiological = flagged.filter(s => groupOf(s) !== 'sleep' && s.key !== 'temperature')
  // Garmin stress and Body Battery both use HRV. Treat them as support for
  // one kind of change rather than three independent warnings.
  const core = new Set(physiological.map(groupOf))
  const support = new Set(flagged.map(groupOf))
  const farOff = physiological.some(s => s.z >= FAR_OFF && !s.baselineNights)

  // NightSignal's rule: sleeping HR above usual on two successive nights.
  const hrNow = signals.find(s => s.key === 'sleeping_hr')
  let hrTwoNights = false
  if (hrNow?.off && !hrNow.baselineNights) {
    const prev = computeSignalOne(lookup, shiftDate(date, -1), 'sleeping_hr', extras)
    hrTwoNights = prev != null && prev >= OFF
  }

  const labels = (extras.labels ?? []).find(l => l.local_date === date)?.tags ?? []
  const explanations = explain(date, extras)

  let level: SignalLevel
  if (core.size >= 2 && (support.size >= 3 || farOff || hrTwoNights)) level = 'strong'
  else if ((core.size >= 1 && support.size >= 2) || hrTwoNights) level = 'mild'
  else if (signals.length < 2 || signals.every(s => groupOf(s) === 'sleep')) level = 'learning'
  else level = 'clear'

  const reasons = new Map<ReturnType<typeof groupOf>, string>()
  for (const signal of flagged) {
    const group = groupOf(signal)
    if (!reasons.has(group)) reasons.set(group, signal.phrase)
  }
  const offPhrases = [...reasons.values()]
  let headline: string
  let advice: string
  let short: string | null = null
  if (level === 'learning' && signals.length === 0 && nights < MIN_BASELINE_NIGHTS) {
    headline = 'Learning your usual nights'
    advice = `Body signals start after ${MIN_BASELINE_NIGHTS} nights of wearing the watch to bed (${nights} so far).`
  } else if (level === 'learning') {
    // Enough nights for some reading (often an imported overnight HRV with a
    // long history), but a warning compares two or more, and the rest either
    // has no usual yet or nothing from last night.
    headline = 'Not enough from last night yet'
    if (signals.length && signals.every(s => groupOf(s) === 'sleep')) {
      advice = offPhrases.length
        ? `${capitalize(offPhrases[0])}. Sleep alone gives limited evidence of broader strain.`
        : 'Sleep could be compared with your usual. More overnight readings are needed to assess strain.'
    } else {
      advice = signals.length
        ? `Only one reading (${signals[0].label}) could be compared with your usual. Body signals need two, so keep the watch on overnight.`
        : "None of last night's readings could be compared with your usual yet. Keep the watch on overnight."
    }
  } else if (level === 'clear') {
    headline = flagged.length ? 'An overnight change stood out' : 'Compared readings are in range'
    advice = flagged.length
      ? `${capitalize(offPhrases[0])}. The available readings give limited evidence of broader strain.`
      : 'The overnight readings we could compare are in your usual range.'
  } else if (level === 'mild') {
    headline = 'Your body is under some strain'
    advice = `${capitalize(offPhrases.slice(0, 2).join(' and '))}. Go easier today and get to bed early.`
    short = 'Signs of strain'
  } else {
    headline = 'Several signs of overnight strain'
    const named = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(offPhrases.slice(0, 3))
    advice = `${capitalize(named)}. Take it easy today and skip hard training if you feel unwell.`
    short = 'Rest: strain signs'
  }
  if (level !== 'learning' && level !== 'clear' && explanations.length) {
    advice += ` It could also be ${explanations.join(' or ')}.`
  }
  if (labels.length) advice += ` You noted ${labels.map(labelText).join(', ')}.`

  return { date, level, signals, nights, hrTwoNights, headline, advice, short, explanations, labels }
}

function computeSignalOne(lookup: NightLookup, date: string, key: SignalKey, extras: SignalExtras): number | null {
  const spec = SPECS.find(s => s.key === key)!
  const now = lookup(date)[key]
  if (now == null) return null
  const prior: number[] = []
  for (let i = 1; i <= BASELINE_NIGHTS; i++) {
    const day = shiftDate(date, -i)
    if (WINDOW_KEYS.has(key) && !!extras.nights?.has(day) !== !!extras.nights?.has(date)) continue
    const v = lookup(day)[key]
    if (v != null) prior.push(v)
  }
  if (prior.length < MIN_BASELINE_NIGHTS) return null
  const center = median(prior)
  const spread = Math.max(spec.floor, 1.4826 * median(prior.map(v => Math.abs(v - center))))
  return (spec.worse * (now - center)) / spread
}

/** Mornings the track record looks back over. The body read holds 35 days and
 *  a morning needs 7 usual nights before it, so older mornings could never be
 *  flagged; looking further back would only promise a longer record. */
export const RECORD_DAYS = 28

/** How often the warnings were right: flagged mornings you labelled, and
 *  how many of those you said you were sick within two days. */
export function signalTrackRecord(daysList: DailyBody[], until: string, extras: SignalExtras = {}): { flagged: number; labelled: number; sick: number } {
  let flagged = 0, labelled = 0, sick = 0
  const days = new Map(daysList.map(d => [d.local_date, d]))
  const readings = new Map<string, ReturnType<typeof nightOf>>()
  const lookup = (date: string) => {
    const prior = readings.get(date)
    if (prior) return prior
    const night = nightOf(days, date, extras)
    readings.set(date, night)
    return night
  }
  const labels = new Map((extras.labels ?? []).map(l => [l.local_date, l.tags]))
  for (let i = 0; i < RECORD_DAYS; i++) {
    const date = shiftDate(until, -i)
    const s = signalsFor(date, extras, lookup)
    if (s.level !== 'mild' && s.level !== 'strong') continue
    flagged++
    const around = [date, shiftDate(date, 1), shiftDate(date, 2)].map(d => labels.get(d) ?? [])
    if (around.some(t => t.length)) labelled++
    if (around.some(t => t.includes('sick'))) sick++
  }
  return { flagged, labelled, sick }
}
