import 'server-only'

import { createServiceClient } from '@/lib/supabase/admin'
import { sendPushToSubscription } from '@/lib/push/webPush'
import { garminSignals } from '@/lib/body/garminSignals'
import { shiftDate } from '../model'
import { dateInZone } from '../importers'
import { readGarminBody } from './queries'

export async function recordGarminMorning(userId: string) {
  const db = createServiceClient()
  const state = await db.from('garmin_personal_sync').select('time_zone,push_enabled,last_success_at')
    .eq('user_id', userId).eq('enabled', true).maybeSingle()
  if (state.error || !state.data?.last_success_at) return
  const now = new Date()
  const today = dateInZone(now.toISOString(), state.data.time_zone)
  if (!today) return
  const cloud = await readGarminBody(db, userId, today)
  const nights = new Map(cloud.rows.map(r => [r.local_date, r]))
  const end = Date.parse(nights.get(today)?.sleep_end ?? '')
  const fresh = Number.isFinite(end) && end <= now.getTime() && now.getTime() - end <= 18 * 3600_000
  const level = fresh ? garminSignals(nights, today).level : 'learning'
  const record = await db.rpc('garmin_personal_record_morning', {
    p_user: userId, p_date: today, p_level: level, p_sync_at: state.data.last_success_at
  })
  if (record.error || !record.data || process.env.GARMIN_PERSONAL_PUSH_PILOT_VERIFIED !== 'true' ||
    !state.data.push_enabled || level !== 'mild') return

  let episode = today
  for (let age = 1; age < 28; age++) {
    const prior = shiftDate(today, -age)
    if (garminSignals(nights, prior).level !== 'mild') break
    episode = prior
  }
  const targets = await db.from('push_subscriptions').select('endpoint,p256dh,auth').eq('user_id', userId).limit(50)
  if (targets.error || !targets.data.length) return
  const claimed = await db.rpc('garmin_personal_claim_push', { p_user: userId, p_today: today, p_episode: episode })
  if (claimed.error || !claimed.data) return
  const payload = { title: 'GRIND', body: 'Your latest update is ready.', url: '/progress/health#signals', tag: 'grind-health' }
  await Promise.allSettled(targets.data.map(async target => {
    if (await sendPushToSubscription(target, payload) === 'gone') {
      await db.from('push_subscriptions').delete().eq('endpoint', target.endpoint).eq('user_id', userId)
    }
  }))
}
