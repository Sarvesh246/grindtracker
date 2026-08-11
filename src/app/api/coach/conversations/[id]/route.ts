import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

/** Load messages for one conversation (owner only via RLS). */
export async function GET(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: conv, error: convErr } = await supabase
    .from('coach_conversations')
    .select('id, title, created_at, updated_at')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (convErr) {
    console.error('[grind] coach conversation get', convErr)
    return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 })
  }
  if (!conv) {
    return NextResponse.json({ error: 'Chat not found' }, { status: 404 })
  }

  const { data: messages, error: msgErr } = await supabase
    .from('coach_messages')
    .select('id, role, content, created_at')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
    .limit(200)

  if (msgErr) {
    console.error('[grind] coach conversation messages', msgErr)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }

  return NextResponse.json({
    conversation: {
      id: conv.id as string,
      title: conv.title as string,
      createdAt: conv.created_at as string,
      updatedAt: conv.updated_at as string,
    },
    messages: (messages ?? []).map(m => ({
      id: m.id as string,
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
    })),
  })
}

/** Delete a conversation and its messages (cascade). */
export async function DELETE(_request: Request, ctx: Ctx) {
  const { id } = await ctx.params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { error } = await supabase.rpc('grind_coach_delete_conversation', {
    p_conversation_id: id,
  })

  if (error) {
    // Fallback: direct delete if RPC missing but RLS delete policy exists.
    const { error: delErr } = await supabase
      .from('coach_conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', user.id)
    if (delErr) {
      console.error('[grind] coach conversation delete', error, delErr)
      return NextResponse.json(
        {
          error:
            delErr.message?.includes('coach_conversations') ||
            delErr.code === '42P01'
              ? 'Coach chats are not ready. Apply docs/sql/35-coach-conversations.sql.'
              : 'Failed to delete chat',
        },
        { status: 503 },
      )
    }
  }

  return NextResponse.json({ ok: true })
}
