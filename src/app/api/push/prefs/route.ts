import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_NOTIFICATION_PREFS } from '@/lib/push/types'

const HOURS = new Set([17, 18, 19, 20, 21])

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

  const patch: Record<string, unknown> = {
    user_id: user.id,
    updated_at: new Date().toISOString(),
  }

  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.rest_complete === 'boolean') patch.rest_complete = body.rest_complete
  if (typeof body.rest_warning_10s === 'boolean') patch.rest_warning_10s = body.rest_warning_10s
  if (typeof body.workout_status === 'boolean') patch.workout_status = body.workout_status
  if (typeof body.streak_reminder === 'boolean') patch.streak_reminder = body.streak_reminder
  if (typeof body.timezone === 'string' && body.timezone.trim()) {
    const tz = body.timezone.trim().slice(0, 64)
    // Reject non-IANA values so schedule_streak_reminders can't abort for everyone.
    try {
      Intl.DateTimeFormat('en-US', { timeZone: tz })
      patch.timezone = tz
    } catch {
      return NextResponse.json({ error: 'Invalid timezone' }, { status: 400 })
    }
  }
  if (typeof body.streak_reminder_hour === 'number') {
    const h = Math.round(body.streak_reminder_hour)
    if (!HOURS.has(h)) {
      return NextResponse.json({ error: 'streak_reminder_hour must be 17–21' }, { status: 400 })
    }
    patch.streak_reminder_hour = h
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
