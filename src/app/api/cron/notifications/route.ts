import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendPushToSubscription } from '@/lib/push/webPush'
import { reportError } from '@/lib/utils/reportError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') || ''
  return header === `Bearer ${secret}`
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

export async function POST(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Also accept GET for Vercel Cron (which uses GET by default unless configured).
  return runCron()
}

export async function GET(request: Request) {
  if (!authorize(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runCron()
}

async function runCron() {
  let streakScheduled = 0
  let sent = 0
  let gone = 0
  let errors = 0

  try {
    const supabase = createServiceClient()

    const { data: streakCount, error: streakErr } = await supabase.rpc('schedule_streak_reminders')
    if (streakErr) {
      console.error('[grind] schedule_streak_reminders', streakErr)
    } else {
      streakScheduled = typeof streakCount === 'number' ? streakCount : Number(streakCount) || 0
    }

    const { data: rows, error: claimErr } = await supabase.rpc('claim_due_notifications', {
      p_limit: 200,
    })
    if (claimErr) {
      console.error('[grind] claim_due_notifications', claimErr)
      return NextResponse.json({ error: 'Claim failed', detail: claimErr.message }, { status: 500 })
    }

    const claimed = (rows || []) as ClaimedRow[]
    const goneEndpoints = new Set<string>()

    for (const row of claimed) {
      if (goneEndpoints.has(row.endpoint)) continue

      const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<
        string,
        unknown
      >
      // Ensure tag defaults per kind.
      if (!payload.tag) {
        payload.tag =
          row.kind === 'streak_daily'
            ? 'grind-streak'
            : row.kind === 'rest_warn'
              ? 'grind-rest-warn'
              : row.kind === 'rest_end'
                ? 'grind-rest'
                : 'grind'
      }
      if (row.kind === 'rest_end' && payload.renotify == null) {
        payload.renotify = true
      }

      const result = await sendPushToSubscription(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload,
      )

      if (result === 'ok') {
        sent++
      } else if (result === 'gone') {
        gone++
        goneEndpoints.add(row.endpoint)
        await supabase.from('push_subscriptions').delete().eq('endpoint', row.endpoint)
      } else {
        errors++
      }
    }

    // Best-effort prune of old terminal rows (ignore failures).
    try {
      await supabase.rpc('grind_prune_scheduled_notifications')
    } catch {
      /* migration 30 may not be applied yet */
    }

    return NextResponse.json({
      ok: true,
      streakScheduled,
      claimed: claimed.length,
      sent,
      gone,
      errors,
    })
  } catch (err) {
    reportError(err, { operation: 'cron-notifications', route: '/api/cron/notifications' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    )
  }
}
