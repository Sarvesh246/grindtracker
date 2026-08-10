import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { ScheduleAction } from '@/lib/push/types'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { actions?: ScheduleAction[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const actions = Array.isArray(body.actions) ? body.actions : []
  if (actions.length === 0) {
    return NextResponse.json({ ok: true })
  }
  if (actions.length > 20) {
    return NextResponse.json({ error: 'Too many actions' }, { status: 400 })
  }

  for (const action of actions) {
    if (action.action === 'cancel') {
      const sessionId = action.sessionId?.trim()
      if (!sessionId || sessionId.length > 64) {
        return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 })
      }
      const { error } = await supabase.rpc('cancel_rest_schedules', {
        p_session_id: sessionId,
      })
      if (error) {
        // Fallback if RPC not applied yet: soft cancel via update.
        const { error: updErr } = await supabase
          .from('scheduled_notifications')
          .update({ cancelled_at: new Date().toISOString() })
          .eq('user_id', user.id)
          .in('kind', ['rest_end', 'rest_warn'])
          .is('cancelled_at', null)
          .is('sent_at', null)
          .like('dedupe_key', `rest:${sessionId}:%`)
        if (updErr) {
          console.error('[grind] schedule cancel', error, updErr)
          return NextResponse.json({ error: 'Cancel failed' }, { status: 500 })
        }
      }
      continue
    }

    if (action.action === 'cancel_keys') {
      const keys = (action.dedupeKeys || []).filter(k => typeof k === 'string' && k.length < 200)
      if (keys.length === 0) continue
      const { error } = await supabase
        .from('scheduled_notifications')
        .update({ cancelled_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .in('dedupe_key', keys)
        .is('cancelled_at', null)
        .is('sent_at', null)
      if (error) {
        console.error('[grind] schedule cancel_keys', error)
        return NextResponse.json({ error: 'Cancel failed' }, { status: 500 })
      }
      continue
    }

    if (action.action === 'upsert') {
      if (action.kind !== 'rest_end' && action.kind !== 'rest_warn') {
        return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
      }
      const fireAt = Date.parse(action.fireAt)
      if (!Number.isFinite(fireAt)) {
        return NextResponse.json({ error: 'Invalid fireAt' }, { status: 400 })
      }
      // Don't accept schedules more than 3 hours out (rest timers are short).
      if (fireAt > Date.now() + 3 * 60 * 60 * 1000) {
        return NextResponse.json({ error: 'fireAt too far in the future' }, { status: 400 })
      }
      // More than ~30s in the past won't help a rest timer — skip insert so
      // hourly Hobby cron doesn't deliver a stale "rest over" much later.
      if (fireAt < Date.now() - 30_000) {
        continue
      }
      const dedupeKey = action.dedupeKey?.trim()
      if (!dedupeKey || dedupeKey.length > 200 || !dedupeKey.startsWith('rest:')) {
        return NextResponse.json({ error: 'Invalid dedupeKey' }, { status: 400 })
      }

      const { error } = await supabase.from('scheduled_notifications').upsert(
        {
          user_id: user.id,
          kind: action.kind,
          fire_at: new Date(fireAt).toISOString(),
          payload: action.payload ?? {},
          dedupe_key: dedupeKey,
          cancelled_at: null,
          sent_at: null,
        },
        { onConflict: 'dedupe_key' },
      )
      if (error) {
        console.error('[grind] schedule upsert', error)
        return NextResponse.json({ error: 'Schedule failed' }, { status: 500 })
      }
    }
  }

  return NextResponse.json({ ok: true })
}
