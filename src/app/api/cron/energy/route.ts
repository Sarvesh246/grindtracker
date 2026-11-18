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

async function run() {
  try {
    const supabase = createServiceClient()
    const { data: prefs, error } = await supabase
      .from('notification_prefs')
      .select('user_id,timezone,energy_kinds,energy_lead_min')
      .eq('enabled', true)
      .eq('energy_alerts', true)
      .limit(1000)
    if (error) throw error

    let queued = 0
    let failed = 0
    for (const pref of prefs ?? []) {
      try {
        queued += await refreshUserSchedule(supabase, pref)
      } catch (err) {
        // One user's bad data must not stop everyone else's alerts.
        failed++
        reportError(err, { operation: 'energy-refresh', route: '/api/cron/energy' })
      }
    }

    const sent = await sendDueNotifications(supabase)
    return NextResponse.json({ ok: true, users: prefs?.length ?? 0, queued, failed, ...sent })
  } catch (err) {
    reportError(err, { operation: 'cron-energy', route: '/api/cron/energy' })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cron failed' }, { status: 500 })
  }
}
