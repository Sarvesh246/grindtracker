import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Lightweight error sink for reportError(). Logs structured JSON to the
 * server (Vercel runtime logs) with an optional authenticated user id.
 * Never echoes the payload back; always returns 204 so the client can
 * fire-and-forget.
 */
export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new NextResponse(null, { status: 204 })
  }

  let userId: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    userId = user?.id ?? null
  } catch {
    // reporting must never fail the request
  }

  // Log a fixed set of fields with length caps, never the raw body: this is
  // an authenticated endpoint but the payload is still caller-controlled.
  const raw =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : ({} as Record<string, unknown>)
  const cap = (v: unknown, max: number) =>
    typeof v === 'string' ? v.slice(0, max) : undefined
  let extra: string | undefined
  if (raw.extra !== undefined) {
    try {
      extra = JSON.stringify(raw.extra)?.slice(0, 2000)
    } catch {
      extra = undefined
    }
  }
  const safe = {
    message: cap(raw.message, 500) ?? 'invalid payload',
    name: cap(raw.name, 100),
    route: cap(raw.route, 200),
    operation: cap(raw.operation, 100),
    digest: cap(raw.digest, 100),
    ts: cap(raw.ts, 40),
    extra,
  }

  console.error(
    '[grind:client-error]',
    JSON.stringify({
      ...safe,
      user_id: userId,
      received_at: new Date().toISOString(),
    }),
  )

  return new NextResponse(null, { status: 204 })
}
