import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

function authorize(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Daily: trims raw health samples, batch receipts and expired insights. Never logs payloads. */
async function run(request: Request) {
  if (!authorize(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data, error } = await createServiceClient().rpc('health_retention_cleanup')
  if (error) {
    console.error('[grind] health_retention_cleanup', error.code)
    return NextResponse.json({ ok: false }, { status: 503 })
  }
  return NextResponse.json({ ok: true, deleted: data })
}
export const GET = run
export const POST = run
