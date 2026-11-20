import { shiftDate, type SleepSession } from '@/lib/health/model'
import {
  DEEP_WAKE_INERTIA_RATE,
  MODEL_VERSION,
  SLEEP_LATENCY_H,
  activeRange,
  alertness,
  circadianPhase,
  confidenceOf,
  inNap,
  phaseTimes,
  sleepDebt,
  startS,
  toPercents,
  DEBT_NIGHTS,
  type DayModel,
} from './model'
import { buildNights } from './nights'
import { recoveryFor, type Recovery } from './recovery'
import { sleepNeed } from './sleepNeed'
import { instantAt } from './time'
import type {
  DailyRecovery,
  EnergyCheckin,
  EnergyEvent,
  EnergySchedule,
  EnergySignal,
  Nap,
  Night,
} from './types'

/** Model nights only (newest first); see `buildNights` for how pieces and sources merge. */
export function nightsFrom(sessions: SleepSession[], beforeOrOn: string): Night[] {
  return buildNights(sessions, beforeOrOn).nights
}

export interface BuildInput {
  date: string
  timezone: string
  sessions: SleepSession[]
  checkins?: EnergyCheckin[]
  /** Once-a-day watch readings; optional, and only ever nudges the curve's height. */
  daily?: DailyRecovery[]
}

/** Recovery has to clear this before the UI calls it out (smaller is day-to-day noise). */
const RECOVERY_SHOWN_Z = 0.5

/** Today's energy schedule, or null when there isn't a single night to go on. */
export function buildEnergySchedule({
  date,
  timezone,
  sessions,
  checkins = [],
  daily = [],
}: BuildInput): EnergySchedule | null {
  const { nights, naps } = buildNights(sessions, date)
  const phase = circadianPhase(nights, checkins)
  if (!phase) return null

  const needH = sleepNeed(nights)
  const debtH = sleepDebt(nights, needH)
  const recovery = recoveryFor(date, nights, daily)
  const today = nights[0]?.wakeDate === date ? nights[0] : null
  const wake = today ? today.wake : phase.habitualWake
  // The newest night (today's, or yesterday's when today's isn't imported yet) acts
  // through this morning's sleep pressure, and only earlier nights count as chronic
  // debt, so a short night is charged once, the same way either way. With no recent
  // night at all, the usual sleep stands in for pressure and every night is debt.
  const lastNight = nights[0] && nights[0].wakeDate >= shiftDate(date, -1) ? nights[0] : null
  const chronicH = sleepDebt(lastNight ? nights.slice(1) : nights, needH)
  const recent = nights.slice(0, 7).map((n) => n.sleepH).sort((a, b) => a - b)
  const lastSleepH = lastNight ? lastNight.sleepH : recent[Math.floor(recent.length / 2)]
  const todayNaps = naps.filter((n) => n.date === date && n.start >= wake)
  const day: DayModel = {
    wake,
    dlmo: phase.dlmo,
    debtH: Math.max(0, chronicH + recovery.debtEquivH),
    lastSleepH,
    naps: todayNaps,
    inertiaRate: today?.wakeStage === 'deep' ? DEEP_WAKE_INERTIA_RATE : undefined,
  }
  const t = phaseTimes(day)

  const at = (h: number) => instantAt(date, h, timezone)
  const bedtime = phase.habitualWake + 24 - needH - SLEEP_LATENCY_H
  const events: EnergyEvent[] = [
    { kind: 'grogginess_end', start: at(t.grogginessEnd) },
    { kind: 'morning_peak', start: at(t.morningPeak[0]), end: at(t.morningPeak[1]) },
    { kind: 'afternoon_dip', start: at(t.dip[0]), end: at(t.dip[1]) },
    { kind: 'evening_peak', start: at(t.eveningPeak[0]), end: at(t.eveningPeak[1]) },
    { kind: 'wind_down', start: at(t.windDown[0]), end: at(t.windDown[1]) },
    { kind: 'bedtime', start: at(bedtime) },
  ]

  // 96 quarter-hours across the local day; asleep (before wake, naps, after bedtime) is null.
  const hours = Array.from({ length: 96 }, (_, i) => (i + 0.5) / 4)
  const isAwake = (h: number) => h >= wake && h <= bedtime && !inNap(day, h)
  const pct = toPercents(hours.filter(isAwake).map((h) => alertness(day, h)), startS(day), activeRange(day))
  let k = 0
  const curve = hours.map((h) => (isAwake(h) ? pct[k++] : null))

  const debtNights = nights.slice(0, DEBT_NIGHTS).map((n) => {
    const slept = n.sleepH + (n.napH ?? 0)
    return {
      date: n.wakeDate,
      sleepMin: Math.round(slept * 60),
      deltaMin: Math.round((needH - slept) * 60),
    }
  })

  return {
    modelVersion: MODEL_VERSION,
    date,
    timezone,
    dayStartAt: at(0),
    wakeAt: at(wake),
    dlmoAt: at(phase.dlmo),
    needMin: Math.round(needH * 60),
    debtMin: Math.round(debtH * 60),
    debtNights,
    calibrationMin: Math.round(phase.calibrationH * 60),
    nights: nights.length,
    confidence: confidenceOf(Math.min(nights.length, DEBT_NIGHTS), phase.midSpread),
    provisional: !today,
    events,
    curve,
    signals: signalsFor({ today, todayNaps, recovery, groggyEnd: at(t.grogginessEnd), date, timezone }),
  }
}

function hm(hours: number): string {
  const m = Math.round(hours * 60)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

/** Plain-language notes on what the watch changed today. Only what actually applied. */
function signalsFor({
  today,
  todayNaps,
  recovery,
  groggyEnd,
  date,
  timezone,
}: {
  today: Night | null
  todayNaps: Nap[]
  recovery: Recovery
  groggyEnd: string
  date: string
  timezone: string
}): EnergySignal[] {
  const clock = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' })
  const out: EnergySignal[] = []

  if (today && (today.pieces ?? 1) > 1) {
    out.push({
      key: 'split_night',
      tone: 'drag',
      label: 'Broken night',
      detail: `${today.pieces} pieces, ${hm(today.sleepH)} asleep in total`,
    })
  }
  for (const nap of todayNaps) {
    out.push({
      key: 'nap',
      tone: 'lift',
      label: 'Nap',
      detail: `${clock(instantAt(date, nap.start, timezone))}–${clock(instantAt(date, nap.end, timezone))} · ${hm(nap.sleepH)} paid back, lift after`,
    })
  }
  if (recovery.parts.length && Math.abs(recovery.z) >= RECOVERY_SHOWN_Z) {
    const name = { hrv: 'HRV', body_battery: 'Body Battery', resting_hr: 'Resting HR' } as const
    const unit = { hrv: ' ms', body_battery: '', resting_hr: ' bpm' } as const
    out.push({
      key: 'recovery',
      tone: recovery.z < 0 ? 'drag' : 'lift',
      label: recovery.z < 0 ? 'Less recovered than usual' : 'Better recovered than usual',
      detail: recovery.parts
        .map((p) => `${name[p.key]} ${Math.round(p.value)}${unit[p.key]} (usual ${Math.round(p.usual)})`)
        .join(' · '),
    })
  }
  if (today?.wakeStage === 'deep') {
    out.push({
      key: 'wake_stage',
      tone: 'drag',
      label: 'Woke from deep sleep',
      detail: `Grogginess runs longer, until ${clock(groggyEnd)}`,
    })
  }
  return out
}
