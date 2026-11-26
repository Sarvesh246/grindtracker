import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parsePushSubscription } from '@/lib/push/subscription'
import { readBoundedJson } from '@/lib/utils/requestBody'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const subscription = parsePushSubscription(await readBoundedJson(request, 8192).catch(() => null))
  if (!subscription) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  // Security-definer RPC transfers endpoint ownership on account switch;
  // a plain RLS upsert cannot update another user's unique(endpoint) row.
  const { error } = await supabase.rpc('upsert_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: subscription.p256dh,
    p_auth: subscription.auth,
    p_expiration_time: subscription.expires,
  })

  if (error?.code === '42501') {
    return NextResponse.json({ error: 'Subscription could not be verified' }, { status: 409 })
  }
  if (error) {
    console.error('[grind] push subscribe upsert', { code: error.code })
    return NextResponse.json({ error: 'Failed to save subscription' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await readBoundedJson(request, 8192).catch(() => null) as { endpoint?: unknown } | null
  const endpoint = body?.endpoint
  // Allow removal of legacy subscriptions with a provider we no longer accept.
  if (typeof endpoint !== 'string' || !endpoint || Buffer.byteLength(endpoint) > 4096) {
    return NextResponse.json({ error: 'Invalid endpoint' }, { status: 400 })
  }

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint)

  if (error) {
    console.error('[grind] push unsubscribe', { code: error.code })
    return NextResponse.json({ error: 'Failed to remove subscription' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
