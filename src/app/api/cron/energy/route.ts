import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { authorizeCron, sendDueNotifications } from '@/lib/push/sendDue'
import { refreshUserSchedule } from '@/lib/energy/server'
import { reportError } from '@/lib/utils/reportError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Driven every 5 minutes by the `grind-energy` pg_cron job (migration 65): keep
 * each opted-in user's energy schedule current, queue its heads-ups, and send
 * whatever is due. The hourly Vercel cron is too coarse for "20 min before".
 */
export async function POST(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

export async function GET(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

/** Users refreshed at once; enough to overlap database round trips without flooding the pool. */
const CONCURRENCY = 8
/** Stop starting new users after this, so the run ends before maxDuration does. */
const BUDGET_MS = 40_000

async function run() {
  const started = Date.now()
  try {
    const supabase = createServiceClient()
    // Due heads-ups go out first: a slow schedule refresh below must never hold back an alert already queued.
    const sent = await sendDueNotifications(supabase)

    const { data: prefs, error } = await supabase
      .from('notification_prefs')
      .select('user_id,timezone,energy_kinds,energy_lead_min')
      .eq('enabled', true)
      .eq('energy_alerts', true)
      .order('user_id')
      .limit(1000)
    if (error) throw error
    const users = prefs ?? []

    let queued = 0
    let failed = 0
    let attempted = 0
    const worker = async () => {
      while (attempted < users.length && Date.now() - started < BUDGET_MS) {
        const pref = users[attempted++]
        try {
          queued += await refreshUserSchedule(supabase, pref)
        } catch (err) {
          // One user's bad data must not stop everyone else's alerts.
          failed++
          reportError(err, { operation: 'energy-refresh', route: '/api/cron/energy' })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, users.length) }, worker))

    return NextResponse.json({
      ok: true,
      users: users.length,
      queued,
      failed,
      deferred: users.length - attempted,
      ...sent,
    })
  } catch (err) {
    reportError(err, { operation: 'cron-energy', route: '/api/cron/energy' })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cron failed' }, { status: 500 })
  }
}
