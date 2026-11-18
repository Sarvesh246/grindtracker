import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { authorizeCron, sendDueNotifications } from '@/lib/push/sendDue'
import { reportError } from '@/lib/utils/reportError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runCron()
}

// Also accept GET for Vercel Cron (which uses GET by default unless configured).
export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runCron()
}

async function runCron() {
  let streakScheduled = 0

  try {
    const supabase = createServiceClient()

    const { data: streakCount, error: streakErr } = await supabase.rpc('schedule_streak_reminders')
    if (streakErr) {
      console.error('[grind] schedule_streak_reminders', streakErr)
    } else {
      streakScheduled = typeof streakCount === 'number' ? streakCount : Number(streakCount) || 0
    }

    let result
    try {
      result = await sendDueNotifications(supabase)
    } catch (claimErr) {
      console.error('[grind] claim_due_notifications', claimErr)
      const detail = claimErr instanceof Error ? claimErr.message : String((claimErr as { message?: string })?.message ?? claimErr)
      return NextResponse.json({ error: 'Claim failed', detail }, { status: 500 })
    }

    // Best-effort prune of old terminal rows (ignore failures).
    try {
      await supabase.rpc('grind_prune_scheduled_notifications')
    } catch {
      /* migration 30 may not be applied yet */
    }

    return NextResponse.json({ ok: true, streakScheduled, ...result })
  } catch (err) {
    reportError(err, { operation: 'cron-notifications', route: '/api/cron/notifications' })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    )
  }
}
