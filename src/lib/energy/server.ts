import type { SupabaseClient } from '@supabase/supabase-js'
import { shiftDate, type SleepSession } from '@/lib/health/model'
import { ALERT_KIND_TO_NOTIFICATION, alertCopy } from './copy'
import { LOOKBACK_DAYS, MODEL_VERSION } from './model'
import { buildEnergySchedule } from './schedule'
import { todayIn, validZone } from './time'
import {
  ALERT_KINDS,
  type AlertKind,
  type DailyRecovery,
  type EnergyCheckin,
  type EnergySchedule,
} from './types'

const SLEEP_COLUMNS =
  'provider_id,source,device_id,wake_date,provider_date,timezone,start_at,end_at,kind,duration_seconds,score,stages,stage_totals,overnight_hrv,respiration,spo2,revision_at,received_at,status'

/** Check-ins older than this stop voting on calibration. */
const CHECKIN_DAYS = 60

export interface EnergyInputs {
  sessions: SleepSession[]
  checkins: EnergyCheckin[]
  /** Watch once-a-day readings (Body Battery at wake, resting HR); empty when unavailable. */
  daily: DailyRecovery[]
  /** Newest received_at across the nights read, for staleness checks. */
  sleepSeenAt: string | null
}

/**
 * Throws on a failed read: a failed read is not an empty account. Every read is
 * newest-first, so when a limit bites it drops the oldest rows, never the latest.
 */
async function loadEnergyInputs(
  client: SupabaseClient,
  userId: string,
  date: string,
): Promise<EnergyInputs> {
  const [sleep, checkins, body] = await Promise.all([
    client
      .from('sleep_sessions')
      .select(SLEEP_COLUMNS)
      .eq('user_id', userId)
      .gte('wake_date', shiftDate(date, -LOOKBACK_DAYS))
      .lte('wake_date', date)
      .order('wake_date', { ascending: false })
      .order('start_at')
      .limit(200),
    client
      .from('energy_checkins')
      .select('local_date,local_hour,feeling')
      .eq('user_id', userId)
      .gte('local_date', shiftDate(date, -CHECKIN_DAYS))
      .order('local_date', { ascending: false })
      .limit(500),
    client
      .from('daily_body')
      .select('local_date,bb_wake,resting_hr,synced_at')
      .eq('user_id', userId)
      .gte('local_date', shiftDate(date, -LOOKBACK_DAYS))
      .lte('local_date', date)
      .order('local_date', { ascending: false })
      .limit(60),
  ])
  if (sleep.error) throw sleep.error
  const sessions = (sleep.data ?? []) as SleepSession[]
  // Check-ins are a refinement: if migration 65 isn't applied yet, carry on without them.
  const rows = checkins.error ? [] : (checkins.data ?? [])
  // Watch readings only refine the curve's height; a failed read just means no refinement.
  const daily = body.error
    ? []
    : (body.data ?? []).map((r) => ({
        date: r.local_date as string,
        bbWake: r.bb_wake == null ? null : Number(r.bb_wake),
        restingHr: r.resting_hr == null ? null : Number(r.resting_hr),
      }))
  return {
    sessions,
    daily,
    checkins: rows.map((r) => ({
      date: r.local_date as string,
      hour: Number(r.local_hour),
      feeling: Number(r.feeling) as -1 | 0 | 1,
    })),
    // Newest input of any kind: a later sleep import OR watch sync triggers a rebuild.
    sleepSeenAt: [
      ...sessions.map((s) => s.received_at),
      ...(body.error ? [] : (body.data ?? []).map((r) => r.synced_at as string)),
    ].reduce<string | null>((max, at) => (at && (!max || at > max) ? at : max), null),
  }
}

/** The zone to read a user's day in: their push timezone, else their newest night's. */
function resolveZone(prefZone: string | null | undefined, sessions: SleepSession[]): string {
  if (validZone(prefZone) && prefZone !== 'UTC') return prefZone
  const newest = [...sessions].sort((a, b) => b.wake_date.localeCompare(a.wake_date))[0]
  if (validZone(newest?.timezone)) return newest.timezone
  return validZone(prefZone) ? prefZone : 'UTC'
}

/** For the page: always computed live from the signed-in user's own rows. */
export async function getEnergySchedule(
  client: SupabaseClient,
  userId: string,
  prefZone: string | null,
  now: Date = new Date(),
): Promise<{ schedule: EnergySchedule | null; timezone: string }> {
  // Read a day of slack either side, then settle "today" in the resolved zone.
  const roughDate = todayIn(validZone(prefZone) ? prefZone : 'UTC', now)
  const inputs = await loadEnergyInputs(client, userId, shiftDate(roughDate, 1))
  const timezone = resolveZone(prefZone, inputs.sessions)
  const date = todayIn(timezone, now)
  return {
    timezone,
    schedule: buildEnergySchedule({
      date,
      timezone,
      sessions: inputs.sessions,
      checkins: inputs.checkins,
      daily: inputs.daily,
    }),
  }
}

interface PrefRow {
  user_id: string
  timezone: string | null
  energy_kinds: string[] | null
  energy_lead_min: number | null
}

/**
 * Cron step for one user: rebuild today's schedule when it is missing, built by
 * an older model, or older than the newest sleep import, then queue its
 * heads-ups. Returns how many notifications were queued (0 when nothing changed).
 */
export async function refreshUserSchedule(
  service: SupabaseClient,
  pref: PrefRow,
  now: Date = new Date(),
): Promise<number> {
  const roughZone = validZone(pref.timezone) ? pref.timezone : 'UTC'
  const inputs = await loadEnergyInputs(service, pref.user_id, shiftDate(todayIn(roughZone, now), 1))
  const timezone = resolveZone(pref.timezone, inputs.sessions)
  const date = todayIn(timezone, now)

  const { data: existing, error: readErr } = await service
    .from('energy_schedules')
    .select('model_version,sleep_seen_at,alert_key:schedule->>alertKey')
    .eq('user_id', pref.user_id)
    .eq('local_date', date)
    .maybeSingle()
  if (readErr) throw readErr
  const lead = pref.energy_lead_min ?? 20
  const kinds = (pref.energy_kinds ?? [...ALERT_KINDS]).filter((k): k is AlertKind =>
    (ALERT_KINDS as readonly string[]).includes(k),
  )
  // Changing which alerts you want, or how early, must re-queue today's.
  const alertKey = `${lead}|${[...kinds].sort().join(',')}`
  const fresh =
    existing &&
    existing.model_version === MODEL_VERSION &&
    existing.alert_key === alertKey &&
    (!inputs.sleepSeenAt ||
      (existing.sleep_seen_at && Date.parse(existing.sleep_seen_at) >= Date.parse(inputs.sleepSeenAt)))
  if (fresh) return 0

  // Replace today's unsent heads-ups; anything already sent stays sent. Runs even
  // when no schedule can be built, so a heads-up for a schedule that has since
  // disappeared (say, the sleep row was deleted) isn't still sent later.
  const prefix = `energy:${pref.user_id}:${date}:`
  const clearUnsent = async () => {
    const { error } = await service
      .from('scheduled_notifications')
      .delete()
      .like('dedupe_key', `${prefix}%`)
      .is('sent_at', null)
    if (error) throw error
  }

  const schedule = buildEnergySchedule({
    date,
    timezone,
    sessions: inputs.sessions,
    checkins: inputs.checkins,
    daily: inputs.daily,
  })
  if (!schedule) {
    await clearUnsent()
    return 0
  }

  const { error: upsertErr } = await service.from('energy_schedules').upsert(
    {
      user_id: pref.user_id,
      local_date: date,
      timezone,
      wake_at: schedule.wakeAt,
      dlmo_at: schedule.dlmoAt,
      need_min: schedule.needMin,
      debt_min: schedule.debtMin,
      confidence: schedule.confidence,
      provisional: schedule.provisional,
      model_version: MODEL_VERSION,
      schedule: { ...schedule, alertKey },
      sleep_seen_at: inputs.sleepSeenAt,
      computed_at: now.toISOString(),
    },
    { onConflict: 'user_id,local_date' },
  )
  if (upsertErr) throw upsertErr

  await clearUnsent()

  const wanted = new Set(kinds)
  const rows = schedule.events
    .filter((e): e is typeof e & { kind: AlertKind } => wanted.has(e.kind as AlertKind))
    .map((e) => ({ event: e, fireAt: Date.parse(e.start) - lead * 60_000 }))
    .filter(({ fireAt }) => fireAt > now.getTime())
    .map(({ event, fireAt }) => ({
      user_id: pref.user_id,
      kind: ALERT_KIND_TO_NOTIFICATION[event.kind],
      fire_at: new Date(fireAt).toISOString(),
      dedupe_key: `${prefix}${event.kind}`,
      payload: {
        ...alertCopy(event, timezone, lead),
        url: '/progress/health/energy',
        tag: `grind-energy-${event.kind}`,
      },
    }))
  if (!rows.length) return 0
  const { error: insErr } = await service
    .from('scheduled_notifications')
    .upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
  if (insErr) throw insErr
  return rows.length
}
