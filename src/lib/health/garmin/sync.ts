import { createServiceClient } from '@/lib/supabase/admin'
import { garminApi, GarminApiError } from './api'
import { addActivityDetails, buildGarminBatch, collectRange, garminZone, type GarminScope } from './collect'
import { dateInZone } from '../importers'
import { shiftDate } from '../model'
import { matchActivities, type GarminActivity } from './normalize'

type Config = { userId: string; key: string }
type Job = {
  connection_id: string
  lease_id: string
  generation: number
  failures: number
  scopes: GarminScope[]
  backfill_date: string | null
  backfill_end: string | null
  last_reconciled_date: string | null
}

async function enrichActivities(db: ReturnType<typeof createServiceClient>, api: ReturnType<typeof garminApi>,
  userId: string, connectionId: string, activities: GarminActivity[], allowGps: boolean) {
  const periods = activities.map(a => a.started_at).sort()
  const earliest = new Date(Date.parse(periods[0] ?? '2000-01-02') - 86_400_000).toISOString()
  const latest = new Date(Date.parse(periods.at(-1) ?? '2000-01-02') + 86_400_000).toISOString()
  const [sessions, existing] = await Promise.all([
    db.from('sessions').select('id,started_at,completed_at,day_type').eq('user_id', userId)
      .gte('started_at', earliest).lte('started_at', latest).not('completed_at', 'is', null).limit(500),
    db.from('garmin_personal_activities').select('provider_id,matched_session_id')
      .eq('connection_id', connectionId).gte('started_at', earliest).lte('started_at', latest).limit(500)
  ])
  if (sessions.error || existing.error) throw new Error('activity_read')
  const occupied = new Map(existing.data.flatMap(e => e.matched_session_id ? [[e.matched_session_id, e.provider_id]] : []))
  matchActivities(activities, sessions.data, occupied)
  const seen = new Set(existing.data.map(e => e.provider_id))
  const mode = allowGps ? 'gps' : 'activity'
  const pending = await db.from('garmin_personal_activities')
    .select('provider_id,local_date,started_at,ended_at,activity_type,name,matched_session_id,match_status')
    .eq('connection_id', connectionId).is('details->>file_checked', null)
    .order('started_at', { ascending: false }).limit(4)
  if (pending.error) throw new Error('activity_read')
  const queued = pending.data.map((row): GarminActivity => ({
    id: row.provider_id, date: row.local_date, started_at: row.started_at, ended_at: row.ended_at,
    type: row.activity_type, name: row.name, details: {}, route: undefined,
    match_status: row.match_status, matched_session_id: row.matched_session_id
  }))
  const byId = new Map(activities.map(a => [a.id, a]))
  const work = [...queued.map(a => byId.get(a.id) ?? a), ...activities.filter(a => !seen.has(a.id))].slice(0, 4)
  await Promise.all(work.map(async a => {
    await addActivityDetails(api, a, allowGps)
    a.details.file_checked = mode
    byId.set(a.id, a)
  }))
  return [...byId.values()]
}

export async function syncGarmin(config: Config, manual = false) {
  const { userId, key } = config
  const db = createServiceClient()
  const claimed = await db.rpc('garmin_personal_claim', { p_user: userId, p_manual: manual })
  if (claimed.error) return { status: 'storage' as const }
  if (!claimed.data) return { status: 'idle' as const }

  const job = claimed.data as Job
  const now = new Date()
  const api = garminApi(key, fetch, AbortSignal.timeout(39_000))
  const envelope = { p_user: userId, p_lease: job.lease_id, p_generation: job.generation }

  try {
    const zone = await garminZone(api)
    const today = dateInZone(now.toISOString(), zone)!
    const nightly = job.last_reconciled_date !== today
    const first = shiftDate(today, nightly ? -7 : -2)
    const active = await collectRange(api, first, today, zone, job.scopes, now, true)
    let cursor = job.backfill_date ?? shiftDate(today, -8)
    const limit = job.backfill_end ?? shiftDate(today, -89)
    // Start with the closest missing dates so the overnight baseline fills first.
    const historyStart = cursor >= limit ? [shiftDate(cursor, -1), limit].sort().at(-1)! : null
    const history = historyStart
      ? await collectRange(api, historyStart, cursor, zone, job.scopes, now, false) : null
    if (historyStart) cursor = shiftDate(historyStart, -1)

    const combined = await enrichActivities(db, api, userId, job.connection_id,
      [...active.activities, ...(history?.activities ?? [])], job.scopes.includes('gps'))
    const days = [...active.days, ...(history?.days ?? [])]
    const sleeps = [...active.sleeps, ...(history?.sleeps ?? [])]
    const batches = [...new Set([...days.map(d => d.date), ...sleeps.map(s => s.provider_date)])].flatMap(date => {
      const batch = buildGarminBatch({
        days: days.filter(d => d.date === date), sleeps: sleeps.filter(s => s.provider_date === date), activities: []
      }, job.generation, now, zone)
      return batch ? [batch] : []
    })
    const result = await db.rpc('garmin_personal_finish', {
      ...envelope, p_batch: batches, p_days: days, p_activities: combined, p_zone: zone,
      p_backfill_date: cursor, p_backfill_end: limit, p_reconciled: today, p_error: null,
      p_due_at: new Date(Date.now() + (cursor >= limit ? 5 : 30) * 60_000).toISOString()
    })
    if (result.error) throw new Error('storage')
    return result.data ? { status: 'synced' as const, days: days.length, activities: combined.length }
      : { status: 'idle' as const }
  } catch (error) {
    const code = error instanceof GarminApiError ? error.code : 'storage'
    const providerDelay = error instanceof GarminApiError ? error.retryAt ?? 0 : 0
    const delay = Math.min(3 * 60 * 60_000, 5 * 60_000 * 2 ** job.failures)
    const result = await db.rpc('garmin_personal_finish', {
      ...envelope, p_batch: [], p_days: [], p_activities: [], p_zone: null, p_error: code,
      p_backfill_date: null, p_backfill_end: null, p_reconciled: null,
      p_due_at: new Date(Math.max(Date.now() + delay, providerDelay)).toISOString()
    })
    return { status: result.error ? 'storage' as const : code }
  }
}
