import { randomUUID } from 'node:crypto'
import { dateInZone, validZone } from '../importers'
import { validateHealthBatch } from '../ingestion'
import { shiftDate } from '../model'
import type { GarminApi } from './api'
import { decodeActivityFile } from './activityFile'
import {
  dated, label, list, normalizeActivity, normalizeCycle, normalizeDaily, normalizeFood, normalizeSleep,
  number, object, projectNumeric, stamp, timedValues,
  type GarminActivity, type GarminDay
} from './normalize'

export const scopes = ['food', 'cycle', 'gps'] as const
export type GarminScope = typeof scopes[number]

function span(first: string, last: string) {
  return { startDate: first, endDate: last }
}

export async function garminZone(api: GarminApi) {
  const zone = label(object(await api.get('/userprofile-service/userprofile/settings')).timeZone)
  if (!validZone(zone)) throw new Error('time_zone')
  return zone
}

export async function probeGarmin(api: GarminApi, now: Date) {
  const zone = await garminZone(api)
  const today = dateInZone(now.toISOString(), zone)!
  const date = shiftDate(today, -1)
  const [sleep, hrv, daily, activities] = await Promise.all([
    api.get('/sleep-service/sleep/dailySleep', { date }),
    api.get('/hrv-service/hrv/' + date),
    api.get('/usersummary-service/v2/dailysummaries', span(date, date)),
    api.get('/activitylist-service/activities/search/activities', { start: '0', limit: '1' })
  ])
  const nightly = normalizeSleep(sleep, hrv, date, zone, now)
  const day = normalizeDaily(list(object(daily).data)[0], date)
  const capabilities = {
    sleep: nightly.sleeps.some(s => s.kind === 'main'),
    sleep_stages: nightly.sleeps.some(s => !!s.stages?.length),
    sleeping_hr: nightly.sleepData?.sleep_avg_hr != null,
    overnight_hrv: nightly.sleepData?.overnight_hrv != null,
    sleep_respiration: nightly.sleepData?.sleep_avg_respiration != null,
    sleep_spo2: nightly.sleepData?.sleep_spo2 != null,
    wellness: Object.keys(day).length > 0,
    activity: list(activities).length > 0
  }
  return { zone, capabilities }
}

async function getDate(api: GarminApi, date: string, daily: unknown, battery: unknown, zone: string,
  enabled: GarminScope[], now: Date) {
  const [sleep, hrv, hr, spo2, food, cycle] = await Promise.all([
    api.get('/sleep-service/sleep/dailySleep', { date }),
    api.get('/hrv-service/hrv/' + date),
    api.get('/wellness-service/wellness/dailyHeartRate', { date }),
    api.get('/wellness-service/wellness/daily/spo2acclimation/' + date),
    enabled.includes('food') ? api.get('/nutrition-service/food/logs/' + date,
      { includeNutrition: 'true', includeMedia: 'false' }) : null,
    enabled.includes('cycle') ? api.get('/periodichealth-service/menstrualcycle/dayview/' + date,
      { reducedResponse: 'true' }) : null
  ])
  const normalized = normalizeSleep(sleep, hrv, date, zone, now)
  const sleeps = normalized.sleeps.filter(s => validateHealthBatch({
    version: 1, batch_id: randomUUID(), generation: 0, source: 'garmin_personal',
    captured_at: now.toISOString(), samples: [], sleeps: [s]
  }, now).success)
  const sleepData = sleeps.some(s => s.kind === 'main') ? normalized.sleepData : null
  const dailyHr = dated(hr, date), dailySpO2 = dated(spo2, date)
  const hrTrace = timedValues(dailyHr.heartRateValues, dailyHr.heartRateValueDescriptors, [/^timestamp$/i, /^heart.?rate$/i], 250)
    .filter(([, bpm]) => bpm >= 20)
  const batteryTrace = timedValues(object(battery).bodyBatteryValuesArray,
    object(battery).bodyBatteryValueDescriptorDTOList, [/^timestamp$/i, /^bodyBatteryLevel$/i], 100)
  const m = normalizeDaily(daily, date)
  if (Object.keys(m).length || hrTrace.length || batteryTrace.length || sleepData) m.time_zone = zone
  const hrvTrace = list(object(hrv).hrvReadings).slice(0, 300).flatMap(r => {
    const v = object(r), time = stamp(v.readingTimeGMT), value = number(v.hrvValue, 1, 500)
    return time && value != null ? [[Date.parse(time), value]] : []
  })
  if (hrTrace.length) m.hr_trace = hrTrace
  if (batteryTrace.length) m.battery_trace = batteryTrace
  if (hrvTrace.length && sleepData) m.hrv_trace = hrvTrace
  const observed = hrTrace.at(-1)?.[0]
  const scheduledEnd = stamp(m.day_end ?? dailyHr.endTimestampGMT)
  if (scheduledEnd && scheduledEnd <= now.toISOString()) m.day_end = scheduledEnd
  else if (observed) m.day_end = stamp(observed)
  else delete m.day_end
  const start = stamp(dailyHr.startTimestampGMT)
  if (!m.day_start && start) m.day_start = start
  const resting = number(dailyHr.restingHeartRate, 20, 150)
  if (resting != null) m.resting_hr = resting
  const oxygen = number(dailySpO2.averageSpO2, 50, 100)
  if (oxygen != null) m.spo2 = oxygen
  const lastBattery = batteryTrace.at(-1)
  if (lastBattery) m.battery_observed_at = stamp(lastBattery[0])
  return {
    day: { date, measurements: { ...m, ...sleepData }, food: normalizeFood(food), cycle: normalizeCycle(cycle) },
    sleeps
  }
}

async function activities(api: GarminApi, first: string, last: string, zone: string) {
  const all: GarminActivity[] = []
  for (let start = 0; start < 200; start += 50) {
    const page = list(await api.get('/activitylist-service/activities/search/activities', {
      ...span(first, last), start: String(start), limit: '50'
    }))
    for (const row of page) {
      const a = normalizeActivity(row, zone)
      if (a && a.date >= first && a.date <= last && !all.some(r => r.id === a.id)) all.push(a)
    }
    if (page.length < 50) return all
  }
  throw new Error('activity_page_limit')
}

export async function addActivityDetails(api: GarminApi, a: GarminActivity, gps: boolean) {
  const base = '/activity-service/activity/' + a.id
  const [detail, workouts, file] = await Promise.all([
    api.get(base),
    api.get(base + '/workouts'),
    api.activityFile(a.id)
  ])
  const raw = object(detail)
  const summary = object(raw.summaryDTO)
  const device = label(object(raw.metadataDTO).manufacturer)
  if (device) a.details.manufacturer = device
  const extra = projectNumeric(summary, ['activityTrainingLoad', 'averageSpeed', 'maxSpeed', 'averageRunCadence', 'averagePower'])
  Object.assign(a.details, extra)
  const splits = list(raw.splitSummaries).slice(0, 100).map(r =>
    projectNumeric(r, ['duration', 'distance', 'elevationGain', 'averageHR']))
    .filter(r => Object.keys(r).length)
  if (splits.length) a.details.splits = splits
  const steps = list(workouts).slice(0, 12).flatMap(w => list(object(w).steps).slice(0, 100).map(object))
    .map(s => ({ exercise: label(s.exerciseName ?? s.name), category: label(s.exerciseCategory),
      durationType: label(s.durationType), ...projectNumeric(s, ['durationValue', 'exerciseWeightValue']) }))
    .filter(s => s.exercise || s.category)
  if (steps.length) a.details.workout_steps = steps
  const fit = file && await decodeActivityFile(file, gps)
  if (fit) {
    if (fit.trace.length) a.details.trace = fit.trace
    if (fit.laps.length) a.details.fit_laps = fit.laps
    if (fit.sets.length) a.details.fit_sets = fit.sets
    if (fit.route?.length) a.route = fit.route
  }
}

const records = (input: unknown) => list(input).map(object)

async function extras(api: GarminApi, first: string, last: string, current: boolean) {
  const [weight, goals, vo2, age, zones, wellness] = await Promise.all([
    api.get('/weight-service/weight/range/' + first + '/' + last, { includeAll: 'true' }),
    api.get('/goal-service/goal/user/effective/weightgoal/' + first + '/' + last),
    api.get('/metrics-service/metrics/maxmet/daily/' + first + '/' + last),
    current ? api.get('/fitnessage-service/fitnessage/v2/' + last) : null,
    current ? api.get('/biometric-service/heartRateZones/v2') : null,
    api.get('/wellnessactivity-service/activity/summary/range/' + first + '/' + last)
  ])
  return { weight, goals, vo2, age, zones, wellness }
}

function addExtras(day: GarminDay, data: Awaited<ReturnType<typeof extras>>, latest: string) {
  const m = day.measurements
  const w = records(object(data.weight).dailyWeightSummaries).find(r => r.summaryDate === day.date)
  const scale = object(w?.latestWeight)
  const grams = number(scale.weight, 10_000, 700_000)
  if (grams != null) {
    m.weight_kg = grams / 1000
    Object.assign(m, projectNumeric(scale, ['bmi', 'bodyFat', 'bodyWater']))
  }
  const goalDate = (v: unknown) => label(object(v).localDate ?? object(v).date ?? v)?.slice(0, 10)
  const goal = records(object(data.goals).userGoals).find(g =>
    (goalDate(g.startDate) ?? '') <= day.date && (goalDate(g.endDate) ?? '9999') >= day.date)
  const target = number(goal?.goalValue ?? goal?.targetValue ?? goal?.weightGoal, 10_000, 700_000)
  if (target != null) m.weight_goal_kg = target / 1000
  const aerobic = records(data.vo2).flatMap(r => [object(r.generic), object(r.cycling), object(r.rowing)])
    .filter(r => r.calendarDate === day.date)
    .map(v => number(v.vo2MaxPrecise ?? v.vo2MaxValue, 10, 100)).filter(v => v != null)
  if (aerobic.length) m.vo2_max = aerobic[0]
  if (day.date === latest) {
    const zoneRows = records(data.zones).map(r => ({
      sport: label(r.sport), ...projectNumeric(r, ['zone1Floor', 'zone2Floor', 'zone3Floor', 'zone4Floor', 'zone5Floor'])
    }))
    if (zoneRows.length) m.hr_zones = zoneRows
    const age = number((records(data.age)[0] ?? object(data.age)).fitnessAge, 10, 130)
    if (age != null) m.fitness_age = age
  }
  const wellness = records(data.wellness).filter(v => v.calendarDate === day.date).slice(0, 24)
    .map(v => ({ type: label(v.wellnessActivityType), start: stamp(v.startTimestampGMT), end: stamp(v.endTimestampGMT) }))
    .filter(v => v.start && v.end && v.end > v.start)
  if (wellness.length) m.wellness_activities = wellness
}

export async function collectRange(api: GarminApi, first: string, last: string, zone: string,
  enabled: GarminScope[], now: Date, current: boolean) {
  const dates: string[] = []
  for (let date = first; date <= last; date = shiftDate(date, 1)) dates.push(date)
  const [daily, battery, act, extra] = await Promise.all([
    api.get('/usersummary-service/v2/dailysummaries', span(first, last)),
    api.get('/wellness-service/wellness/bodyBattery/reports/daily', span(first, last)),
    activities(api, first, last, zone),
    extras(api, first, last, current)
  ])
  const days: GarminDay[] = []
  const sleeps = []
  for (const date of dates) {
    const result = await getDate(api, date,
      records(object(daily).data).find(r => r.calendarDate === date),
      records(battery).find(r => r.date === date), zone, enabled, now)
    addExtras(result.day, extra, last)
    if (Object.keys(result.day.measurements).length || result.day.food || result.day.cycle) days.push(result.day)
    sleeps.push(...result.sleeps)
  }
  return { days, sleeps, activities: act }
}

const samples = [
  ['resting_hr', 'bpm', 'average'], ['steps', 'steps', 'total'],
  ['body_battery', 'score', 'point'], ['stress', 'score', 'average'],
  ['respiration', 'breaths/min', 'average'], ['spo2', 'percent', 'average']
] as const

export function buildGarminBatch(data: Awaited<ReturnType<typeof collectRange>>, generation: number, now: Date, zone: string) {
  const captured = now.toISOString()
  const candidates = data.days.flatMap(d => samples.flatMap(([metric, unit, kind]) => {
    const value = number(d.measurements[metric])
    const start = stamp(d.measurements.day_start), end = stamp(d.measurements.day_end)
    if (value == null || !start || !end || start > end || end > captured || dateInZone(start, zone) !== d.date) return []
    const observed = metric === 'body_battery' ? stamp(d.measurements.battery_observed_at) ?? end : end
    if (observed > captured || observed < start || observed > end) return []
    // Garmin reports exclusive midnight at the end of some complete-day summaries.
    const last = shiftDate(d.date, 1) === dateInZone(end, zone) && end > start ? stamp(Date.parse(end) - 1)! : end
    return [{ provider_id: 'garmin_personal:' + d.date + ':' + metric, metric,
      start_at: kind === 'point' ? observed : start, end_at: kind === 'point' ? observed : last,
      observed_at: observed, revision_at: captured, value, unit, kind,
      quality: d.date === dateInZone(captured, zone) && kind !== 'point' ? 'partial' : 'current' }]
  }))
  const base = { version: 1, batch_id: randomUUID(), generation, source: 'garmin_personal', captured_at: captured }
  const verified = candidates.filter(s => validateHealthBatch({ ...base, samples: [s], sleeps: [] }, now).success)
  const sleeps = data.sleeps.filter(s => validateHealthBatch({ ...base, samples: [], sleeps: [s] }, now).success)
  const batch = validateHealthBatch({ ...base, samples: verified, sleeps }, now)
  if (!batch.success) throw new Error('batch_validation')
  return batch.data.samples.length || batch.data.sleeps.length ? batch.data : null
}
