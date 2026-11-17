import type { SupabaseClient } from '@supabase/supabase-js'
import { getBodySummary } from '@/lib/body/queries'
import {
  mainSleep,
  shiftDate,
  type HealthHistoryDay,
  type SleepSession,
  type SleepReadState
} from './model'

export async function getHealthSummary(client: SupabaseClient, userId: string, date: string) {
  const [body, sleep, history] = await Promise.all([
    getBodySummary(client, userId, date),
    client
      .from('sleep_sessions')
      .select(
        'provider_id,source,device_id,wake_date,provider_date,timezone,start_at,end_at,kind,duration_seconds,score,stages,stage_totals,overnight_hrv,respiration,spo2,revision_at,received_at,status'
      )
      .eq('user_id', userId)
      .gte('wake_date', shiftDate(date, -89))
      .lte('wake_date', date)
      .order('wake_date')
      .limit(400),
    client
      .from('daily_body')
      .select(
        'local_date,bb_latest,resting_hr,recovery_hours,steps,stress_avg,active_minutes,floors,spo2,vo2max,synced_at'
      )
      .eq('user_id', userId)
      .gte('local_date', shiftDate(date, -89))
      .lte('local_date', date)
      .order('local_date')
  ])
  const sleepState: SleepReadState = !sleep.error
    ? 'ready'
    : ['42P01', 'PGRST205'].includes(sleep.error.code)
      ? 'not_enabled'
      : 'error'
  const sleeps = (sleep.data ?? []) as SleepSession[]
  const legacyHistory = (history.data ?? []) as HealthHistoryDay[]
  const dates = new Set([
    ...legacyHistory.map((d) => d.local_date),
    ...sleeps.map((s) => s.wake_date)
  ])
  const canonicalHistory: HealthHistoryDay[] = [...dates]
    .sort()
    .map((local_date) => ({
      ...legacyHistory.find((d) => d.local_date === local_date),
      local_date,
      overnight_hrv: mainSleep(sleeps, local_date)?.overnight_hrv ?? null
    }))
  return { body, sleeps, sleepState, history: canonicalHistory, historyError: !!history.error }
}
export type HealthSummary = Awaited<ReturnType<typeof getHealthSummary>>
