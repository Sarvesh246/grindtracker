import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { runTuning } from '@/lib/reps/tuning'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Nightly: re-tunes the watch rep counter per user and exercise from their
 *  rep lab sets (src/lib/reps/tuning.ts). Logs counts only, never data. */
async function run(request: Request) {
  if (!authorize(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const r = await runTuning(createServiceClient(), 45_000)
    return NextResponse.json({
      ok: true,
      considered: r.considered,
      tuned: r.tuned.length,
      applied: r.tuned.filter(t => t.applied).length,
      skipped: r.skipped,
      timed_out: r.timedOut,
    })
  } catch (err) {
    console.error('[grind] rep tuning', err instanceof Error ? err.message : 'failed')
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
export const GET = run
export const POST = run
