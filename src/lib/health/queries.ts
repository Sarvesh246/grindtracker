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

const SAMPLE_METRICS = [
  'resting_hr',
  'hrv',
  'spo2',
  'steps',
  'recovery_hours',
  'body_battery',
  'stress'
]

export async function getHealthSummary(
  client: SupabaseClient,
  userId: string,
  date: string,
  timeZone?: string
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
      .order('local_date'),
    // Raw UTC samples and connections are additive: a missing table or a failed
    // read must leave the legacy view intact, never break the page.
    client
      .from('health_samples')
      .select(
        'connection_id,metric,provider_id,start_at,end_at,observed_at,revision_at,value,unit,kind,quality'
      )
      .eq('user_id', userId)
      .in('metric', SAMPLE_METRICS)
      .gte('end_at', new Date(Date.parse(`${shiftDate(date, -90)}T00:00:00Z`)).toISOString())
      .order('end_at', { ascending: false })
      .limit(3000),
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
  const sleeps = (sleep.data ?? []) as SleepSession[]
  const links = (connections.error ? [] : (connections.data ?? [])) as HealthConnection[]
  const sourceOf = new Map(links.map((c) => [c.id, c.source]))
  const sampleRows: SampleRow[] = samples.error
    ? []
    : ((samples.data ?? []) as (Omit<SampleRow, 'source'> & { connection_id: string })[]).flatMap(
        ({ connection_id, ...row }) => {
          const source = sourceOf.get(connection_id)
          return source
            ? [{ ...row, value: row.value == null ? null : Number(row.value), source }]
            : []
        }
      )
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
    connections: links,
    provenance,
    workouts: (workouts.error ? [] : (workouts.data ?? [])) as HealthWorkout[]
  }
}
export type HealthSummary = Awaited<ReturnType<typeof getHealthSummary>>
