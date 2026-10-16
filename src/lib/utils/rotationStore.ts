import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserRotation } from '@/lib/types'
import { enabledDayKeys } from './dayKeys'
import {
  advanceIndex,
  dayAtIndex,
  effectiveSequence,
  nextDay,
  resolveRotationIndex,
  type LastCompletion,
} from './rotation'

/**
 * Supabase I/O for the rotation pointer. Every place that reads "up next" or
 * moves the pointer (finish, quick-save, skip, undo) goes through here, so the
 * Start button, Log's UP NEXT badge and the Coach all resolve the same slot.
 * The pure rules live in rotation.ts (resolveRotationIndex).
 */

export interface RotationState {
  rotation: UserRotation | null
  dayKeys: string[]
  seq: string[]
  /** Resolved pointer — see resolveRotationIndex. */
  index: number
  nextDay: string | null
}

/** Everything needed to resolve the pointer, read fresh. `excludeSessionId`
 *  leaves out a session that was JUST completed, so the finish path doesn't
 *  count its own completion as a missed advance and then advance twice. */
export async function loadRotationState(
  supabase: SupabaseClient,
  userId: string,
  opts: { excludeSessionId?: string } = {},
): Promise<RotationState> {
  let lastQuery = supabase
    .from('sessions')
    .select('day_type, completed_at')
    .eq('user_id', userId)
    .not('completed_at', 'is', null)
  if (opts.excludeSessionId) lastQuery = lastQuery.neq('id', opts.excludeSessionId)

  const [{ data: dayTypeRows, error: dayErr }, { data: rotationRow, error: rotErr }, { data: flexRows }, { data: lastRow }] =
    await Promise.all([
      supabase.from('exercises').select('day_type, active').eq('user_id', userId),
      supabase.from('user_rotation').select('*').eq('user_id', userId).maybeSingle(),
      supabase.from('user_flex_days').select('day_key').eq('user_id', userId),
      lastQuery.order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    ])
  // A failed read must not masquerade as "no rotation" — a write built on it
  // would reset the user's place in the loop.
  if (dayErr) throw dayErr
  if (rotErr) throw rotErr

  const dayKeys = enabledDayKeys(dayTypeRows ?? [])
  const rotation = (rotationRow as UserRotation | null) ?? null
  const flex = new Set((flexRows ?? []).map((r: { day_key: string }) => r.day_key))
  const seq = effectiveSequence(rotation, dayKeys, flex)
  const last = lastRow as { day_type: string; completed_at: string } | null
  const lastCompletion: LastCompletion | null = last
    ? { day: last.day_type, completedAt: last.completed_at }
    : null
  const index = resolveRotationIndex(seq, rotation, lastCompletion)
  return { rotation, dayKeys, seq, index, nextDay: nextDay(seq, index) }
}

// Set once a write proves `current_day` isn't in the schema yet (migration 54
// not applied), so later writes stop paying for the failed attempt.
let currentDayColumnMissing = false

function isMissingCurrentDayColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST204' || /current_day/.test(error.message ?? '')
}

/** Upsert the pointer. Always writes `current_day` alongside `current_index`
 *  (the two must never disagree) and falls back to index-only when the column
 *  doesn't exist yet. */
export async function writeRotationPointer(
  supabase: SupabaseClient,
  userId: string,
  rotation: Pick<UserRotation, 'mode' | 'sequence'> | null,
  seq: string[],
  index: number,
): Promise<{ error: Error | null }> {
  const base = {
    user_id: userId,
    mode: rotation?.mode ?? 'auto',
    sequence: rotation?.sequence ?? [],
    current_index: index,
    updated_at: new Date().toISOString(),
  }
  if (!currentDayColumnMissing) {
    const { error } = await supabase
      .from('user_rotation')
      .upsert({ ...base, current_day: dayAtIndex(seq, index) }, { onConflict: 'user_id' })
    if (!error) return { error: null }
    if (!isMissingCurrentDayColumn(error)) return { error: new Error(error.message) }
    currentDayColumnMissing = true
  }
  const { error } = await supabase.from('user_rotation').upsert(base, { onConflict: 'user_id' })
  return { error: error ? new Error(error.message) : null }
}

/** Upsert a whole rotation row whose pointer is being reset or set directly
 *  (onboarding, templates, the Coach's weekly plan). Same column fallback. */
export async function writeRotationRow(
  supabase: SupabaseClient,
  row: { user_id: string; mode: 'auto' | 'manual'; sequence: string[]; current_index: number; current_day: string | null },
): Promise<{ error: { message: string } | null }> {
  const stamped = { ...row, updated_at: new Date().toISOString() }
  if (!currentDayColumnMissing) {
    const { error } = await supabase.from('user_rotation').upsert(stamped, { onConflict: 'user_id' })
    if (!error || !isMissingCurrentDayColumn(error)) return { error }
    currentDayColumnMissing = true
  }
  const { current_day: _omit, ...legacy } = stamped
  const { error } = await supabase.from('user_rotation').upsert(legacy, { onConflict: 'user_id' })
  return { error }
}

export interface PointerSnapshot {
  index: number
  day: string | null
}

/** Advance past a day the user just completed. Returns the pointer as it was
 *  BEFORE (for the finish-undo token), or null if nothing was written. */
export async function advanceRotationAfterFinish(
  supabase: SupabaseClient,
  userId: string,
  completedDay: string,
  sessionId: string,
): Promise<PointerSnapshot | null> {
  const state = await loadRotationState(supabase, userId, { excludeSessionId: sessionId })
  if (state.seq.length === 0) return null
  const prev = { index: state.index, day: dayAtIndex(state.seq, state.index) }
  const newIndex = advanceIndex(state.seq, state.index, completedDay)
  const { error } = await writeRotationPointer(supabase, userId, state.rotation, state.seq, newIndex)
  return error ? null : prev
}

/** Put the pointer back where a snapshot says it was (finish undo, skip undo). */
export async function restoreRotationPointer(
  supabase: SupabaseClient,
  userId: string,
  snapshot: PointerSnapshot,
): Promise<{ error: Error | null }> {
  const state = await loadRotationState(supabase, userId)
  // Re-anchor the snapshot against today's sequence in case it shifted since.
  const index = resolveRotationIndex(state.seq, { current_index: snapshot.index, current_day: snapshot.day })
  return writeRotationPointer(supabase, userId, state.rotation, state.seq, index)
}

export type SkipResult =
  | { ok: true; skipped: string; next: string; prev: PointerSnapshot; state: RotationState }
  /** What's actually up next differs from what the user was looking at —
   *  nothing was written; show them `state.nextDay` instead. */
  | { ok: false; reason: 'stale'; state: RotationState }
  | { ok: false; reason: 'empty' }

/** Skip the up-next day. `expectedDay` is the day the user tapped Skip on —
 *  if fresh state says something else is next, refuse rather than skip a day
 *  they never saw. */
export async function skipUpNext(
  supabase: SupabaseClient,
  userId: string,
  expectedDay: string,
): Promise<SkipResult> {
  const state = await loadRotationState(supabase, userId)
  const skipped = state.nextDay
  if (!skipped || state.seq.length === 0) return { ok: false, reason: 'empty' }
  if (skipped !== expectedDay) return { ok: false, reason: 'stale', state }
  const prev = { index: state.index, day: dayAtIndex(state.seq, state.index) }
  const newIndex = advanceIndex(state.seq, state.index, skipped)
  const { error } = await writeRotationPointer(supabase, userId, state.rotation, state.seq, newIndex)
  if (error) throw error
  const after = { ...state, index: newIndex, nextDay: nextDay(state.seq, newIndex) }
  return { ok: true, skipped, next: after.nextDay ?? skipped, prev, state: after }
}
