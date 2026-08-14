import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/push/types'
import { validateNotificationPrefsPatch } from '@/lib/push/validatePrefs'

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('notification_prefs')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    console.error('[grind] prefs get', error)
    return NextResponse.json({ error: 'Failed to load prefs' }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({
      prefs: { user_id: user.id, ...DEFAULT_NOTIFICATION_PREFS },
    })
  }

  return NextResponse.json({ prefs: data })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const validated = validateNotificationPrefsPatch(body)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.reason }, { status: 400 })
  }

  const patch: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
    ...validated.patch,
  }

  const { data, error } = await supabase
    .from('notification_prefs')
    .upsert(patch, { onConflict: 'user_id' })
    .select('*')
    .maybeSingle()

  if (error) {
    console.error('[grind] prefs patch', error)
    return NextResponse.json({ error: 'Failed to save prefs' }, { status: 500 })
  }

  return NextResponse.json({ prefs: data })
}
