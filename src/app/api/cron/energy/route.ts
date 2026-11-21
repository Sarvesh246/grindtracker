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

    let queued = 0
    let failed = 0
    let attempted = 0
    while (Date.now() - started < BUDGET_MS) {
      const { data, error } = await supabase.rpc('claim_energy_refreshes', { p_limit: CONCURRENCY })
      if (error) throw error
      const prefs = data ?? []
      if (!prefs.length) break
      attempted += prefs.length
      await Promise.all(prefs.map(async (pref: Parameters<typeof refreshUserSchedule>[1] & { lease_until: string }) => {
        let success = false
        try {
          queued += await refreshUserSchedule(supabase, pref)
          success = true
        } catch (err) {
          failed++
          reportError(err, { operation: 'energy-refresh', route: '/api/cron/energy' })
        }
        const { error: settleError } = await supabase.rpc('settle_energy_refresh', {
          p_user: pref.user_id, p_lease: pref.lease_until, p_success: success,
        })
        if (settleError) throw settleError
      }))
    }
    const { data: oldest, error: oldestError } = await supabase.from('notification_prefs')
      .select('energy_refresh_due_at').eq('enabled', true).eq('energy_alerts', true)
      .order('energy_refresh_due_at').limit(1).maybeSingle()
    if (oldestError) throw oldestError
    const oldestOverdueSeconds = oldest
      ? Math.max(0, Math.floor((Date.now() - Date.parse(oldest.energy_refresh_due_at)) / 1000)) : 0
    if (oldestOverdueSeconds > 900) {
      console.warn('[grind] Energy refresh overdue', { oldestOverdueSeconds })
    }

    return NextResponse.json({
      ok: true,
      users: attempted,
      queued,
      failed,
      oldestOverdueSeconds,
      ...sent,
    })
  } catch (err) {
    reportError(err, { operation: 'cron-energy', route: '/api/cron/energy' })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cron failed' }, { status: 500 })
  }
}
