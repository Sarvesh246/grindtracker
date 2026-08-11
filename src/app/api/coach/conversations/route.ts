import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { titleFromMessage } from '@/lib/coach/conversations'

export const runtime = 'nodejs'

/** List the caller's Coach conversations (newest first). */
export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await supabase
    .from('coach_conversations')
    .select('id, title, created_at, updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(50)

  if (error) {
    console.error('[grind] coach conversations list', error)
    return NextResponse.json(
      {
        error:
          error.message?.includes('coach_conversations') || error.code === '42P01'
            ? 'Coach chats are not ready. Apply docs/sql/35-coach-conversations.sql.'
            : 'Failed to load chats',
      },
      { status: 503 },
    )
  }

  return NextResponse.json({
    conversations: (data ?? []).map(row => ({
      id: row.id as string,
      title: row.title as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    })),
  })
}

/** Create an empty conversation (optional — chat route also auto-creates). */
export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let title = 'New chat'
  try {
    const body = (await request.json()) as { title?: unknown }
    if (typeof body.title === 'string' && body.title.trim()) {
      title = titleFromMessage(body.title)
    }
  } catch {
    // empty body is fine
  }

  const { data, error } = await supabase
    .from('coach_conversations')
    .insert({ user_id: user.id, title })
    .select('id, title, created_at, updated_at')
    .single()

  if (error || !data) {
    console.error('[grind] coach conversation create', error)
    return NextResponse.json(
      {
        error:
          error?.message?.includes('coach_conversations') || error?.code === '42P01'
            ? 'Coach chats are not ready. Apply docs/sql/35-coach-conversations.sql.'
            : 'Failed to create chat',
      },
      { status: 503 },
    )
  }

  return NextResponse.json({
    conversation: {
      id: data.id as string,
      title: data.title as string,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string,
    },
  })
}
