import type { SupabaseClient } from '@supabase/supabase-js'
import { clockHoursFrom, validZone } from '@/lib/energy/time'
import { mainSleep, shiftDate, type SleepSession } from '@/lib/health/model'

export interface RecoveryNight {
  /** Local wall-clock hours relative to the wake date. */
  start: number
  end: number
  asleep: { start: number; end: number }[]
  minutes: number
  efficiency: number
  hrv: number | null
}

export function recoveryNights(sessions: SleepSession[]): Map<string, RecoveryNight> {
  const nights = new Map<string, RecoveryNight>()
  for (const date of new Set(sessions.map(s => s.wake_date))) {
    const sleep = mainSleep(sessions, date)
    if (!sleep || !validZone(sleep.timezone)) continue
    const hour = (at: string) => clockHoursFrom(date, at, sleep.timezone)
    const start = hour(sleep.start_at)
    const end = hour(sleep.end_at)
    const elapsed = (Date.parse(sleep.end_at) - Date.parse(sleep.start_at)) / 60_000
    const minutes = sleep.duration_seconds / 60
    if (!(start < end && end - start <= 16 && elapsed > 0 && minutes > 0)) continue
    const stages = (sleep.stages ?? [])
      .filter(s => s.stage !== 'awake')
      .map(s => ({ start: Math.max(start, hour(s.start)), end: Math.min(end, hour(s.end)) }))
      .filter(s => s.start < s.end)
    const stagedMinutes = stages.reduce((sum, s) => sum + (s.end - s.start) * 60, 0)
    nights.set(date, {
      start, end, minutes, efficiency: Math.min(100, minutes / elapsed * 100),
      asleep: stagedMinutes >= 0.7 * minutes ? stages : [{ start, end }],
      hrv: sleep.overnight_hrv,
    })
  }
  return nights
}

/** Two 28-night windows, since the history card also assesses earlier mornings. */
export const SIGNAL_HISTORY_DAYS = 56

export async function readRecoveryNights(db: SupabaseClient, userId: string, today: string) {
  const { data, error } = await db
    .from('sleep_sessions')
    .select('wake_date,start_at,end_at,timezone,kind,stages,score,stage_totals,overnight_hrv,duration_seconds,respiration,spo2,source,device_id,revision_at')
    .eq('user_id', userId)
    .eq('kind', 'main')
    .gte('wake_date', shiftDate(today, -SIGNAL_HISTORY_DAYS))
    .lte('wake_date', today)
    .order('wake_date', { ascending: false })
    .limit(280)
  return error ? new Map<string, RecoveryNight>() : recoveryNights((data ?? []) as SleepSession[])
}

export function overnightReadings(nights: ReadonlyMap<string, RecoveryNight>): Map<string, number> {
  const readings = new Map<string, number>()
  for (const [date, night] of nights) {
    if (typeof night.hrv === 'number' && Number.isFinite(night.hrv) && night.hrv > 0) readings.set(date, night.hrv)
  }
  return readings
}
