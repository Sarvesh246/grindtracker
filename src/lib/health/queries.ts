import type { SupabaseClient } from '@supabase/supabase-js'
import { getBodySummary } from '@/lib/body/queries'
import {
  mainSleep,
  shiftDate,
  type HealthHistoryDay,
  type SleepSession,
  type SleepReadState
} from './model'
import {
  mergeSamplesIntoHistory,
  SAMPLE_HISTORY_FIELD,
  type DayProvenance,
  type HealthSource,
  type SampleRow
} from './reconcile'

export interface HealthConnection {
  id: string
  source: HealthSource
  device_id: string
  status: 'active' | 'paused' | 'revoked' | 'error'
  last_success_at: string | null
  last_error_code: string | null
}
export interface HealthWorkout {
  day_type: string
  started_at: string | null
  completed_at: string | null
}

export async function getHealthSummary(
  client: SupabaseClient,
  userId: string,
  date: string,
  timeZone: string
) {
  const [body, sleep, history, samples, connections, workouts] = await Promise.all([
    getBodySummary(client, userId, date),
    client
      .from('sleep_sessions')
      .select(
        'provider_id,source,device_id,wake_date,provider_date,timezone,start_at,end_at,kind,duration_seconds,score,stages,stage_totals,overnight_hrv,respiration,spo2,revision_at,received_at,status'
      )
      .eq('user_id', userId)
      .gte('wake_date', shiftDate(date, -89))
      .lte('wake_date', date)
      // Newest first so the limit drops the oldest rows; flipped back to ascending below.
      .order('wake_date', { ascending: false })
      .limit(400),
    client
      .from('daily_body')
      .select(
        'local_date,bb_latest,resting_hr,recovery_hours,steps,stress_avg,active_minutes,floors,spo2,vo2max,synced_at'
      )
      .eq('user_id', userId)
      .gte('local_date', shiftDate(date, -89))
      .lte('local_date', date)
      .order('local_date'),
    client.rpc('health_daily_samples', { p_date: date, p_timezone: timeZone }),
    client
      .from('health_connections')
      .select('id,source,device_id,status,last_success_at,last_error_code')
      .eq('user_id', userId),
    client
      .from('sessions')
      .select('day_type,started_at,completed_at')
      .eq('user_id', userId)
      .eq('local_date', date)
      .not('completed_at', 'is', null)
      .order('started_at')
      .limit(6)
  ])
  const sleepState: SleepReadState = !sleep.error
    ? 'ready'
    : ['42P01', 'PGRST205'].includes(sleep.error.code)
      ? 'not_enabled'
      : 'error'
  const sleeps = ((sleep.data ?? []) as SleepSession[]).reverse()
  const links = (connections.error ? [] : (connections.data ?? [])) as HealthConnection[]
  const sampleRows = samples.error || !Array.isArray(samples.data)
    ? []
    : samples.data as (SampleRow & { local_date: string })[]
  const sampleCoverage = sampleRows.map(row => ({
    source: row.source, metric: SAMPLE_HISTORY_FIELD[row.metric], date: row.local_date,
  }))
  const legacyHistory = (history.data ?? []) as HealthHistoryDay[]
  const merged = mergeSamplesIntoHistory(legacyHistory, sampleRows, timeZone)
  const dates = new Set([
    ...merged.history.map((d) => d.local_date),
    ...sleeps.map((s) => s.wake_date)
  ])
  const provenance: Record<string, DayProvenance> = merged.provenance
  const canonicalHistory: HealthHistoryDay[] = [...dates].sort().map((local_date) => {
    const row = merged.history.find((d) => d.local_date === local_date)
    const night = mainSleep(sleeps, local_date)
    // The sleep record states its own method, so it wins over a stand-alone HRV sample.
    if (night?.overnight_hrv != null)
      (provenance[local_date] ??= {}).overnight_hrv = {
        source: 'sleep_record',
        observed_at: night.end_at,
        quality: 'current'
      }
    return {
      ...row,
      local_date,
      overnight_hrv: night?.overnight_hrv ?? row?.overnight_hrv ?? null
    }
  })
  return {
    body,
    sleeps,
    sleepState,
    history: canonicalHistory,
    historyError: !!history.error,
    sampleCoverage,
    sampleHistoryError: !!samples.error,
    connections: links,
    provenance,
    workouts: (workouts.error ? [] : (workouts.data ?? [])) as HealthWorkout[]
  }
}
export type HealthSummary = Awaited<ReturnType<typeof getHealthSummary>>
