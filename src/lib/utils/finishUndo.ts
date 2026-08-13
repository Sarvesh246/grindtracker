/**
 * 10-minute post-finish undo token (`grind_finish_undo`).
 *
 * Written by ActiveWorkout after a live finish and by HomeDashboard after a
 * quick-save. Undo reopens the session via `uncomplete_session` and restores
 * the rotation pointer — stats are re-derived server-side (never stored on
 * the token). Shape must stay in sync across ActiveWorkout, HomeDashboard,
 * and DaySelect writers.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { localDateKey } from '@/lib/utils/formatting'

export const FINISH_UNDO_KEY = 'grind_finish_undo'
export const FINISH_UNDO_EVENT = 'grind:finish-undo'
export const FINISH_UNDO_TTL_MS = 10 * 60 * 1000

export interface FinishUndoToken {
  sessionId: string
  day: string
  userId: string
  xpEarned: number
  /**
   * Rotation pointer to restore. Stats are NOT stored here: undo calls
   * `uncomplete_session`, which reopens the session and lets the server
   * re-derive every stat from the logs.
   */
  prevRotationIndex: number
  expiresAt: number
}

export function readFinishUndoToken(): FinishUndoToken | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(FINISH_UNDO_KEY)
    if (!raw) return null
    const t = JSON.parse(raw) as FinishUndoToken
    if (!t?.sessionId || !t?.userId || typeof t.expiresAt !== 'number') {
      localStorage.removeItem(FINISH_UNDO_KEY)
      return null
    }
    if (Date.now() > t.expiresAt) {
      localStorage.removeItem(FINISH_UNDO_KEY)
      return null
    }
    return t
  } catch {
    return null
  }
}

export function writeFinishUndoToken(token: FinishUndoToken): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(FINISH_UNDO_KEY, JSON.stringify(token))
    window.dispatchEvent(new Event(FINISH_UNDO_EVENT))
  } catch { /* private mode / quota — undo just won't be available */ }
}

export function clearFinishUndoToken(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(FINISH_UNDO_KEY)
    window.dispatchEvent(new Event(FINISH_UNDO_EVENT))
  } catch { /* ignore */ }
}

/** Reopen the session + restore rotation. Returns false on auth/expiry/RPC failure. */
export async function performFinishUndo(
  supabase: SupabaseClient,
  token: FinishUndoToken = readFinishUndoToken()!,
): Promise<boolean> {
  if (!token) return false
  if (Date.now() > token.expiresAt) {
    clearFinishUndoToken()
    return false
  }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.id !== token.userId) return false

  const { error: undoError } = await supabase.rpc('uncomplete_session', {
    p_session_id: token.sessionId,
    p_local_date: localDateKey(new Date()),
  })
  if (undoError) return false

  await supabase
    .from('user_rotation')
    .update({ current_index: token.prevRotationIndex })
    .eq('user_id', user.id)

  clearFinishUndoToken()
  return true
}
