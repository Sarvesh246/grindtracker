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

  const safe =
    body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : { message: 'invalid payload' }

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
