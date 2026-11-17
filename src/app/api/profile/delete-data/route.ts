import { createClient } from '@/lib/supabase/server'
import { clearPrivateAccountFiles } from '@/lib/health/storageCleanup'
import { PROFILE_COOKIE, profileCookieOptions } from '@/lib/setup/profileCookie'
import { NextResponse } from 'next/server'

export const maxDuration = 60
export async function POST(request: Request) {
  const client = await createClient()
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await request.json().catch(() => null)
  if (body?.confirmation !== 'DELETE') return NextResponse.json({ error: 'Confirm deletion with DELETE.' }, { status: 422 })
  try {
    await clearPrivateAccountFiles(client, user.id)
    const result = await client.rpc('delete_my_grind_data')
    if (result.error) throw new Error('Database cleanup failed')
    const response = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
    response.cookies.set(PROFILE_COOKIE, '', profileCookieOptions(0))
    return response
  } catch {
    return NextResponse.json({ error: 'Could not complete deletion. Retry to finish removing your data.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
