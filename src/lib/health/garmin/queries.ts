import type { SupabaseClient } from '@supabase/supabase-js'
import type { DailyBody } from '@/lib/body/types'
import type { GarminSignalNight } from '@/lib/body/garminSignals'
import { shiftDate } from '../model'
import { number, object } from './normalize'

const bodyFields = [
  'sleep_device', 'sleep_status', 'sleep_end', 'sleep_avg_hr', 'sleep_avg_respiration',
  'overnight_hrv', 'sleep_spo2', 'resting_hr', 'stress', 'body_battery', 'body_battery_min',
  'body_battery_max', 'body_battery_charged', 'steps', 'floors', 'spo2', 'vo2_max',
  'intensity_moderate', 'intensity_vigorous', 'day_end', 'battery_observed_at',
  'sleep_duration_seconds', 'sleep_score'
]

export const garminTrends = [
  ['weight_kg', 'Weight', 'kg'], ['weight_goal_kg', 'Weight goal', 'kg'], ['hydration_ml', 'Hydration', 'mL'],
  ['calories_total', 'Total energy', 'kcal'], ['calories_active', 'Active energy', 'kcal'],
  ['intensity_moderate', 'Moderate activity', 'min'], ['intensity_vigorous', 'Vigorous activity', 'min'],
  ['respiration', 'Daily breathing', 'breaths/min'], ['sleep_avg_hr', 'Sleeping heart rate', 'bpm'],
  ['sleep_avg_respiration', 'Sleeping breathing', 'breaths/min'], ['sleep_need_minutes', 'Sleep need', 'min'],
  ['sleep_spo2', 'Overnight oxygen', '%'], ['overnight_hrv', 'Overnight HRV', 'ms'],
  ['vo2_max', 'VO₂ max', 'mL/kg/min'], ['fitness_age', 'Fitness age', 'years'],
  ['body_battery_charged', 'Body Battery charged', 'pts'], ['body_battery_drained', 'Body Battery drained', 'pts']
] as const

const projection = (keys: readonly string[]) => ['local_date', ...keys.map(k => k + ':measurements->' + k)].join(',')

type BodyRow = GarminSignalNight & Record<string, unknown>

export async function readGarminBody(client: SupabaseClient, userId: string, date: string) {
  const [rows, current] = await Promise.all([
    client.from('garmin_personal_days').select(projection(bodyFields))
      .eq('user_id', userId).gte('local_date', shiftDate(date, -56)).lte('local_date', date).order('local_date'),
    client.from('garmin_personal_days')
      .select('hr_trace:measurements->hr_trace,battery_trace:measurements->battery_trace,time_zone:measurements->time_zone')
      .eq('user_id', userId).eq('local_date', date).maybeSingle()
  ])
  return { rows: (rows.data ?? []) as unknown as BodyRow[], traces: object(current.data) }
}

function buckets(input: unknown, date: string, zone: unknown) {
  if (!Array.isArray(input) || typeof zone !== 'string') return null
  try {
    const format = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    })
    const bins: number[][] = Array.from({ length: 96 }, () => [])
    for (const sample of input) {
      if (!Array.isArray(sample) || !Number.isFinite(sample[0]) || !Number.isFinite(sample[1])) continue
      const f = Object.fromEntries(format.formatToParts(sample[0]).map(p => [p.type, p.value]))
      if ([f.year, f.month, f.day].join('-') === date) bins[Number(f.hour) * 4 + Math.floor(Number(f.minute) / 15)]?.push(sample[1])
    }
    return bins.some(b => b.length) ? bins.map(b => b.length ? Math.round(b.reduce((a, v) => a + v, 0) / b.length) : null) : null
  } catch {
    return null
  }
}

export function overlayGarminBody(watch: DailyBody[], cloud: Awaited<ReturnType<typeof readGarminBody>>, today: string) {
  const map = new Map(watch.map(r => [r.local_date, r]))
  for (const r of cloud.rows) {
    const day = map.get(r.local_date)
    const end = typeof r.day_end === 'string' ? r.day_end : null
    const batteryTime = typeof r.battery_observed_at === 'string' ? r.battery_observed_at : end
    const newerBattery = batteryTime && (!day?.synced_at || Date.parse(batteryTime) >= Date.parse(day.synced_at))
    const moderate = number(r.intensity_moderate), vigorous = number(r.intensity_vigorous)
    const available = end && Date.parse(end) <= Date.now() + 60_000 && !Number.isNaN(Date.parse(end))
    if (!available && !day) continue
    const trace = r.local_date === today ? cloud.traces : {}
    const hr = buckets(trace.hr_trace, r.local_date, trace.time_zone)
    const battery = buckets(trace.battery_trace, r.local_date, trace.time_zone)
    map.set(r.local_date, {
      ...day,
      local_date: r.local_date,
      bb_high: day?.bb_high ?? number(r.body_battery_max, 0, 100),
      bb_low: day?.bb_low ?? number(r.body_battery_min, 0, 100),
      bb_latest: newerBattery ? number(r.body_battery, 0, 100) ?? day?.bb_latest ?? null : day?.bb_latest ?? null,
      bb_wake: day?.bb_wake ?? null,
      stress_avg: day?.stress_avg ?? number(r.stress, 0, 100),
      resting_hr: number(r.resting_hr, 20, 150) ?? day?.resting_hr ?? null,
      steps: day?.steps ?? number(r.steps),
      active_minutes: day?.active_minutes ?? (moderate != null || vigorous != null ? (moderate ?? 0) + (vigorous ?? 0) : null),
      floors: day?.floors ?? number(r.floors),
      recovery_hours: day?.recovery_hours ?? null,
      spo2: day?.spo2 ?? number(r.spo2, 50, 100),
      vo2max: day?.vo2max ?? number(r.vo2_max, 10, 100),
      hr_series: hr?.map((v, i) => day?.hr_series?.[i] ?? v) ?? day?.hr_series,
      bb_series: battery?.map((v, i) => day?.bb_series?.[i] ?? v) ?? day?.bb_series,
      synced_at: newerBattery ? batteryTime : day?.synced_at ?? end
    })
  }
  return [...map.values()].sort((a, b) => a.local_date.localeCompare(b.local_date))
}

export interface GarminHealthRead {
  history: (Record<string, unknown> & { local_date: string })[]
  selected: Record<string, unknown>
}

export async function readGarminHealth(client: SupabaseClient, userId: string, date: string): Promise<GarminHealthRead> {
  const [history, selected] = await Promise.all([
    client.from('garmin_personal_days').select(projection(garminTrends.map(([key]) => key)))
      .eq('user_id', userId).gte('local_date', shiftDate(date, -89)).lte('local_date', date).order('local_date'),
    client.from('garmin_personal_days')
      .select(projection(['sleep_alignment','next_sleep_need_minutes','hrv_status','hrv_baseline_low','hrv_baseline_high',
        'hr_zones', 'wellness_activities', 'sleep_stress','hrv_trace','bmi','bodyFat','bodyWater','hydration_goal_ml',
        'day_end','stress_max','min_hr','max_hr']) + ',food,cycle,fetched_at')
      .eq('user_id', userId).eq('local_date', date).maybeSingle()
  ])
  return { history: (history.data ?? []) as unknown as (Record<string, unknown> & { local_date: string })[],
    selected: object(selected.data) }
}
