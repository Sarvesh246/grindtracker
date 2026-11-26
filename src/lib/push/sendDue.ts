import { timingSafeEqual } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { sendPushToSubscription } from './webPush'

/** Bearer CRON_SECRET check, constant-time so the secret can't be probed byte by byte. */
export function authorizeCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  // timingSafeEqual needs equal lengths; the expected length isn't secret.
  return given.length === expected.length && timingSafeEqual(given, expected)
}

type ClaimedRow = {
  notification_id: string
  user_id: string
  kind: string
  payload: Record<string, unknown> | null
  endpoint: string
  p256dh: string
  auth: string
}

const DEFAULT_TAG: Record<string, string> = {
  streak_daily: 'grind-streak',
  rest_warn: 'grind-rest-warn',
  rest_end: 'grind-rest',
}

export interface SendResult {
  claimed: number
  sent: number
  gone: number
  errors: number
}

/**
 * Claim due rows (`for update skip locked`, so the hourly and 5-minute crons can
 * overlap safely) and push each one. Dead endpoints are deleted.
 */
export async function sendDueNotifications(
  supabase: SupabaseClient,
  limit = 200,
): Promise<SendResult> {
  const { data: rows, error } = await supabase.rpc('claim_due_notifications', { p_limit: limit })
  if (error) throw error

  const claimed = (rows || []) as ClaimedRow[]
  let sent = 0
  let gone = 0
  let errors = 0

  for (const row of claimed) {
    const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<
      string,
      unknown
    >
    if (!payload.tag) payload.tag = DEFAULT_TAG[row.kind] ?? 'grind'
    if (row.kind === 'rest_end' && payload.renotify == null) payload.renotify = true

    const result = await sendPushToSubscription(
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
      payload,
    )
    if (result === 'ok') sent++
    else if (result === 'gone') {
      gone++
      await supabase.from('push_subscriptions').delete()
        .eq('endpoint', row.endpoint).eq('user_id', row.user_id).eq('p256dh', row.p256dh).eq('auth', row.auth)
    } else errors++
  }

  return { claimed: claimed.length, sent, gone, errors }
}
