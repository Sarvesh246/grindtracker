import type { SupabaseClient } from '@supabase/supabase-js'
import { authenticatedWorkoutOwner, withWorkoutLock } from '@/lib/offline/sync'
import { changeWorkoutStore, readWorkoutStore, refreshWorkoutStore } from '@/lib/offline/workoutStore'
import { resolveSessionAlias } from '@/lib/offline/localSession'
import { browserIsOffline } from '@/lib/offline/offlineGate'
import { isTransientError } from './offlineQueue'

/** The only discard command used by the workout, Home and Log. */
export async function discardWorkout(supabase: SupabaseClient, owner: string, sessionId: string) {
  try {
    return await withWorkoutLock(owner, async () => {
      await refreshWorkoutStore(owner)
      const sid = resolveSessionAlias(sessionId, owner)
      const draft = readWorkoutStore(owner).drafts.find(entry => entry.id === sid)
      if (!draft || draft.attempted) {
        if (browserIsOffline() || await authenticatedWorkoutOwner(supabase) !== owner) {
          return { ok: false, error: 'Connect to discard this workout.' } as const
        }
        await changeWorkoutStore(owner, state => {
          if (!state.discarding.includes(sid)) state.discarding.push(sid)
        })
        const { data, error } = await supabase.rpc('discard_open_workout', {
          p_owner: owner, p_session_id: sid,
        })
        if (error || data !== true) {
          if (!error || !isTransientError(error)) {
            await changeWorkoutStore(owner, state => { state.discarding = state.discarding.filter(id => id !== sid) })
          }
          return {
            ok: false,
            error: error?.message.includes('SESSION_ALREADY_COMPLETED')
              ? 'This workout was finished in another tab.'
              : 'Could not confirm discard. Try again.',
          } as const
        }
      }
      await changeWorkoutStore(owner, state => {
        state.discarded.push(sid)
        state.discarding = state.discarding.filter(id => id !== sid)
        state.drafts = state.drafts.filter(entry => entry.id !== sid)
        state.ops = state.ops.filter(op => op.sessionId !== sid)
        delete state.notes[sid]
        delete state.resume[sid]
        delete state.finishes[sid]
      })
      return { ok: true } as const
    })
  } catch {
    return { ok: false, error: 'Could not update workout storage. Try again.' } as const
  }
}
