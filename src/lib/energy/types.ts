/** One main sleep in model units: clock hours relative to midnight of its wake date. */
export interface Night {
  wakeDate: string
  /** Sleep onset, e.g. -1 for 23:00 the evening before. */
  onset: number
  /** Final wake, e.g. 7.25 for 07:15. */
  wake: number
  /** Hours actually asleep, summed across the night's pieces (split nights are one night). */
  sleepH: number
  /** Hours of daytime naps on the wake date; counts toward debt, never toward need or phase. */
  napH?: number
  /** How many separate pieces the night was in (2+ = woke up for a while in the middle). */
  pieces?: number
  /** Overnight HRV (ms) when the watch reported it. */
  hrv?: number | null
  /** Stage you woke from, when the source has a stage timeline. */
  wakeStage?: 'deep' | 'rem' | 'light' | null
}

/** A daytime nap in clock hours relative to its own date. */
export interface Nap {
  date: string
  start: number
  end: number
  sleepH: number
}

/** Once-a-day watch readings (daily_body). */
export interface DailyRecovery {
  date: string
  bbWake: number | null
  restingHr: number | null
}

/** Something from the watch that shaped today's schedule, for the "What shaped today" list. */
export interface EnergySignal {
  key: 'split_night' | 'nap' | 'recovery' | 'wake_stage'
  /** lift = raises today's energy, drag = lowers it. */
  tone: 'lift' | 'drag'
  label: string
  detail: string
}

/** A felt-energy tap, as clock hours on its own local day. */
export interface EnergyCheckin {
  date: string
  hour: number
  feeling: -1 | 0 | 1
}

export type EnergyKind =
  | 'grogginess_end'
  | 'morning_peak'
  | 'afternoon_dip'
  | 'evening_peak'
  | 'wind_down'
  | 'bedtime'

/** The four moments that can send a push heads-up. */
export const ALERT_KINDS = ['morning_peak', 'afternoon_dip', 'evening_peak', 'wind_down'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export interface EnergyEvent {
  kind: EnergyKind
  /** ISO instant the phase starts (or the point in time, for bedtime). */
  start: string
  /** ISO instant the phase ends; absent for point events. */
  end?: string
}

export type Confidence = 'low' | 'medium' | 'high'

export interface DebtNight {
  date: string
  sleepMin: number
  /** need − slept, in minutes; negative is surplus. */
  deltaMin: number
}

export interface EnergySchedule {
  modelVersion: number
  date: string
  timezone: string
  /** Local midnight of `date`; curve bucket i covers dayStartAt + i×15 min. */
  dayStartAt: string
  wakeAt: string
  dlmoAt: string
  needMin: number
  debtMin: number
  debtNights: DebtNight[]
  calibrationMin: number
  nights: number
  confidence: Confidence
  /** True when today's wake is the habitual estimate rather than an imported night. */
  provisional: boolean
  events: EnergyEvent[]
  /** 96 quarter-hours of predicted energy (0–100) across `date`; null while asleep. */
  curve: (number | null)[]
  /** Watch-derived adjustments applied today (empty when none had enough data). */
  signals: EnergySignal[]
}
