import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * What happened to the cards the Coach prepared earlier in this chat.
 *
 * Chat history is text only, so the model used to forget which exact change it
 * had proposed and whether the user confirmed, cancelled or ignored it —
 * "make that 4 sets" or "never mind" had nothing concrete to hang on. This is
 * read fresh every turn (it is NOT part of the cached USER_DATA, which can be
 * up to a minute stale) and handed over as a compact list.
 */

export type RecentActionRow = {
  kind: string
  status: string
  expires_at: string | null
  created_at: string
  payload: {
    card?: { title?: string; summaryLines?: string[] }
  } | null
}

const STATUS_WORDS: Record<string, string> = {
  pending: 'PENDING — not applied yet',
  confirmed: 'being applied',
  executed: 'applied',
  cancelled: 'cancelled by the user — not applied',
  failed: 'failed — not applied',
}

function ageLabel(createdAt: string, now: number): string {
  const t = Date.parse(createdAt)
  if (!Number.isFinite(t)) return ''
  const mins = Math.max(0, Math.round((now - t) / 60_000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  return hours < 24 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

export function formatRecentActions(
  rows: ReadonlyArray<RecentActionRow>,
  now = Date.now(),
): string | null {
  if (rows.length === 0) return null
  const lines = rows.map(r => {
    const expired =
      r.status === 'pending' &&
      r.expires_at != null &&
      Date.parse(r.expires_at) <= now
    const status = expired
      ? 'expired — not applied'
      : (STATUS_WORDS[r.status] ?? r.status)
    const card = r.payload?.card
    const title = card?.title ?? r.kind
    const detail = (card?.summaryLines ?? []).slice(0, 4).join('; ')
    return `- ${ageLabel(r.created_at, now)} · ${title} · ${status}${detail ? ` — ${detail}` : ''}`
  })
  return lines.join('\n')
}

export async function loadRecentCoachActions(
  supabase: SupabaseClient,
  userId: string,
  conversationId: string | null,
  limit = 6,
): Promise<RecentActionRow[]> {
  let query = supabase
    .from('coach_action_proposals')
    .select('kind, status, expires_at, created_at, payload')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (conversationId) query = query.eq('conversation_id', conversationId)
  const { data, error } = await query
  if (error || !data) return []
  // Oldest first so the list reads in the order things happened.
  return (data as RecentActionRow[]).reverse()
}
