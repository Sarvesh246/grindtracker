import { dateInZone, parseGarminNap, parseGarminNight } from '../importers'
import { validDate } from '../model'

export const object = (v: unknown): Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
export const list = (v: unknown): unknown[] => Array.isArray(v) ? v : []
export const number = (v: unknown, min = 0, max = 1_000_000_000) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null
export const label = (v: unknown, size = 100) =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, size) : null

export function stamp(v: unknown) {
  const ms = typeof v === 'number' && Number.isSafeInteger(v) ? v :
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d\d:\d\d:\d\d/.test(v)
      ? Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/i.test(v) ? v : v.replace(' ', 'T') + 'Z') : NaN
  if (!(ms >= 946684800000 && ms <= 4102444800000)) return null
  return new Date(ms).toISOString()
}

export type GarminDay = {
  date: string
  measurements: Record<string, unknown>
  food?: Record<string, unknown>
  cycle?: Record<string, unknown>
}

export function dated(v: unknown, date: string) {
  const row = object(v)
  return row.calendarDate === date ? row : {}
}

function compact(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v != null))
}

export function normalizeSleep(sleep: unknown, hrv: unknown, date: string, zone: string, now: Date) {
  const raw = object(sleep)
  const wrapper = Object.keys(object(raw.dailySleepDTO)).length > 0
  const row = dated(wrapper ? raw.dailySleepDTO : raw, date)
  const summary = dated(object(hrv).hrvSummary ?? hrv, date)
  const detail = object(row.sleepNeed)
  const status = row.sleepFromDevice === true && row.sleepWindowConfirmed === true ? 'final' : 'provisional'
  const parsed = parseGarminNight({ dailySleepDTO: row, hrvSummary: summary, sleepLevels: raw.sleepLevels },
    'garmin_personal', { now, fallbackZone: zone })
  const main = parsed.ok ? {
    ...parsed.night, status,
    provider_id: 'garmin_personal:main:' + date,
    revision_at: now.toISOString()
  } as const : null
  const naps = list(row.dailyNapDTOS).slice(0, 10).flatMap(v => {
    if (object(v).calendarDate !== date) return []
    const nap = parseGarminNap(v, { now, fallbackZone: zone })
    return nap.ok ? [{ ...nap.night, provider_id: nap.night.provider_id.replace('garmin_export:', 'garmin_personal:nap:') }] : []
  })
  const alignment = object(row.sleepAlignment)
  const sleepData = main?.wake_date === date ? {
    sleep_end: main.end_at, sleep_start: main.start_at, sleep_status: status,
    sleep_duration_seconds: main.duration_seconds, sleep_score: main.score,
    sleep_device: label(detail.deviceId) ?? (number(detail.deviceId, 1, Number.MAX_SAFE_INTEGER)?.toString() ?? null),
    sleep_avg_hr: number(row.avgHeartRate, 20, 250), sleep_avg_respiration: main.respiration,
    overnight_hrv: main.overnight_hrv, sleep_spo2: main.spo2, sleep_stress: number(row.avgSleepStress, 0, 100),
    sleep_need_minutes: number(detail.actual, 0, 1440),
    next_sleep_need_minutes: number(object(row.nextSleepNeed).actual, 0, 1440),
    sleep_alignment: label(alignment.status) ?? label(row.sleepAlignment),
    hrv_status: label(summary.status, 40), hrv_weekly_average: number(summary.weeklyAvg, 1, 500),
    hrv_baseline_low: number(object(summary.baseline).balancedLow, 1, 500),
    hrv_baseline_high: number(object(summary.baseline).balancedUpper, 1, 500)
  } : null
  return { sleeps: [...(main ? [main] : []), ...naps], sleepData }
}

export function normalizeDaily(input: unknown, date: string) {
  const d = dated(input, date)
  const battery = object(d.bodyBattery), hr = object(d.heartRate), stress = object(d.stress)
  const calories = object(d.calories), intensity = object(d.intensityMinutes)
  const movement = object(d.movement), respiration = object(d.respiration), spo2 = object(d.pulseOx)
  const hydration = object(d.hydration)
  return compact({
    provider_day_id: label(d.uuid), day_start: stamp(object(d.wellnessChronology).startTimestampGmt),
    day_end: stamp(object(d.wellnessChronology).endTimestampGmt),
    steps: number(object(movement.steps).value, 0, 200000),
    floors: number(object(movement.floorsAscended).value),
    resting_hr: number(hr.restingValue, 20, 150), min_hr: number(hr.minValue, 20, 250),
    max_hr: number(hr.maxValue, 20, 250),
    stress: number(stress.avgLevel, 0, 100), stress_max: number(stress.maxLevel, 0, 100),
    body_battery: number(battery.latestValue, 0, 100), body_battery_charged: number(battery.chargedValue),
    body_battery_drained: number(battery.drainedValue), body_battery_min: number(battery.minValue, 0, 100),
    body_battery_max: number(battery.maxValue, 0, 100),
    respiration: number(respiration.avgValue, 1, 80), spo2: number(spo2.avgValue, 50, 100),
    intensity_moderate: number(intensity.moderate), intensity_vigorous: number(intensity.vigorous),
    calories_total: number(calories.burnedTotal), calories_active: number(calories.burnedActive),
    hydration_ml: number(hydration.consumedInFractionalMl) ?? number(hydration.consumedInMl),
    hydration_goal_ml: number(hydration.goalInFractionalMl) ?? number(hydration.goalInMl)
  })
}

export function timedValues(rows: unknown, descriptors: unknown, keys: [RegExp, RegExp], max: number) {
  const desc = list(descriptors).map(object)
  const index = (regex: RegExp) => {
    const d = desc.find(r => Object.values(r).some(v => typeof v === 'string' && regex.test(v)))
    return number(d?.index ?? d?.bodyBatteryValueDescriptorIndex, 0, 20)
  }
  const time = index(keys[0]), value = index(keys[1])
  if (time == null || value == null || time === value) return []
  return list(rows).slice(0, 1600).flatMap(v => {
    if (!Array.isArray(v)) return []
    const t = stamp(v[time]), n = number(v[value], 0, max)
    return t && n != null ? [[Date.parse(t), n]] : []
  })
}

export function normalizeActivity(input: unknown, zone: string) {
  const a = object(input)
  const id = typeof a.activityId === 'number' && Number.isSafeInteger(a.activityId) && a.activityId > 0
    ? String(a.activityId) : null
  const start = stamp(a.beginTimestamp) ?? stamp(a.startTimeGMT)
  const duration = number(a.elapsedDuration, 1, 604800) ?? number(a.duration, 1, 604800)
  const end = stamp(a.endTimeGMT) ?? (start && duration ? stamp(Date.parse(start) + duration * 1000) : null)
  const localDate = label(a.startTimeLocal)?.slice(0, 10)
  const date = validDate(localDate) ? localDate : (start && dateInZone(start, zone))
  const type = label(object(a.activityType).typeKey, 60)
  if (!id || !start || !end || !date || !type || end <= start || a.parent === true || a.isParent === true) return null
  return {
    id, date, started_at: start, ended_at: end, type,
    name: label(a.activityName, 120) ?? type.replaceAll('_', ' '),
    details: compact({
      duration_seconds: number(a.duration), distance_m: number(a.distance), ascent_m: number(a.elevationGain),
      descent_m: number(a.elevationLoss), average_hr: number(a.averageHR, 20, 250),
      max_hr: number(a.maxHR, 20, 250), calories: number(a.calories), steps: number(a.steps),
      reps: number(a.totalReps ?? a.totalExerciseReps), sets: number(a.totalSets), laps: number(a.lapCount),
      aerobic_effect: number(a.aerobicTrainingEffect, 0, 5), anaerobic_effect: number(a.anaerobicTrainingEffect, 0, 5),
      zone_seconds: [1, 2, 3, 4, 5].map(i => number(a['hrTimeInZone_' + i]))
    }),
    matched_session_id: null as string | null,
    match_status: 'unmatched' as 'unmatched' | 'matched' | 'review',
    route: undefined as [number, number][] | undefined
  }
}

export type GarminActivity = NonNullable<ReturnType<typeof normalizeActivity>>
export type GrindInterval = { id: string; started_at: string; completed_at: string; day_type: string }

export function matchActivities(activities: GarminActivity[], sessions: GrindInterval[], occupied: Map<string, string>) {
  const candidates = new Map<string, GrindInterval[]>()
  const reverse = new Map<string, number>()
  for (const a of activities) {
    if (!/^(strength_training|strength|resistance_training)$/.test(a.type)) continue
    const start = Date.parse(a.started_at), end = Date.parse(a.ended_at)
    const matches = sessions.filter(s => {
      const first = Date.parse(s.started_at), last = Date.parse(s.completed_at)
      const seconds = Math.min(end, last) - Math.max(start, first)
      return !!s.day_type && last > first && seconds >= 0.8 * (end - start) && seconds >= 0.8 * (last - first)
    })
    candidates.set(a.id, matches)
    for (const s of matches) reverse.set(s.id, (reverse.get(s.id) ?? 0) + 1)
  }
  for (const a of activities) {
    const matches = candidates.get(a.id) ?? []
    if (!matches.length) continue
    a.match_status = 'review'
    const [s] = matches
    if (matches.length === 1 && reverse.get(s.id) === 1 && (!occupied.has(s.id) || occupied.get(s.id) === a.id)) {
      a.matched_session_id = s.id
      a.match_status = 'matched'
    }
  }
}

export function projectNumeric(v: unknown, keys: string[]) {
  const row = object(v)
  return compact(Object.fromEntries(keys.map(key => [key, number(row[key])])))
}

export function normalizeFood(v: unknown) {
  const row = object(v)
  const totals = projectNumeric(row.dailyNutritionContent, ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium'])
  const meals = list(row.mealDetails).slice(0, 30).map(object).map(m => ({
    name: label(object(m.meal).mealName ?? object(m.meal).defaultMealName ?? m.mealName),
    totals: projectNumeric(m.nutritionContent ?? m.mealNutritionContent ?? m.nutrition, ['calories', 'protein', 'carbs', 'fat']),
    foods: list(m.loggedFoods ?? m.foods ?? m.foodDetails).slice(0, 30).map(object)
      .map(item => label(object(item.foodMetaData).foodName ?? object(item.foodMetaData).name ?? item.name)).filter(Boolean)
  })).filter(m => m.name || Object.keys(m.totals).length || m.foods.length)
  return Object.keys(totals).length || meals.length ? { totals, meals } : undefined
}

export function normalizeCycle(v: unknown) {
  const r = object(v), summary = object(r.daySummary ?? r.cycleSummary ?? r.summary ?? r)
  const val = compact({
    phase: label(summary.currentPhase), type: label(summary.cycleType), day: number(summary.dayInCycle, 1, 365),
    week: number(summary.numberOfWeek, 1, 50), due_date: validDate(label(summary.dueDate)) ? summary.dueDate : null
  })
  return Object.keys(val).length ? val : undefined
}
