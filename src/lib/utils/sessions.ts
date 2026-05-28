import type { SupabaseClient } from '@supabase/supabase-js'

/** Remove every in-progress session (and its logs) for a day type. */
export async function deleteIncompleteSessions(
  supabase: SupabaseClient,
  userId: string,
  dayType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: sessions, error: fetchError } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', userId)
    .eq('day_type', dayType)
    .is('completed_at', null)

  if (fetchError) return { ok: false, error: fetchError.message }

  const ids = (sessions ?? []).map((s) => s.id)
  if (ids.length === 0) return { ok: true }

  const { error: logsError } = await supabase
    .from('session_logs')
    .delete()
    .in('session_id', ids)

  if (logsError) return { ok: false, error: logsError.message }

  const { error: sessionsError } = await supabase.from('sessions').delete().in('id', ids)

  if (sessionsError) return { ok: false, error: sessionsError.message }

  return { ok: true }
}
