import type { SupabaseClient } from '@supabase/supabase-js'
import { readRecoveryNights } from '@/lib/body/sleep'
import { createServiceClient } from '@/lib/supabase/admin'
import { advanceRotationAfterFinish } from '@/lib/utils/rotationStore'
import type { WatchDeps } from './handlers'

/**
 * Production wiring for the watch handlers: the service-role client (the
 * watch has no Supabase session; the user id comes from its token, verified in
 * `watch_authenticate`). Every RPC used here is granted to service_role only.
 */

let client: SupabaseClient | null = null
function service(): SupabaseClient {
  client ??= createServiceClient()
  return client
}

function log(message: string, error: unknown) {
  // Server logs only (Vercel). Never log the request body or token.
  console.error(`[grind] watch: ${message}`, error)
}

export function productionWatchDeps(): WatchDeps {
  return {
    rpc: async (fn, args) => {
      const { data, error } = await service().rpc(fn, args)
      return { data, error: error ? { message: error.message, code: error.code } : null }
    },
    recoveryNights: (userId, date) => readRecoveryNights(service(), userId, date),
    afterCompletion: async ({ userId, sessionId, workoutId, completedAt }) => {
      try {
        const supabase = service()
        // Advance "up next" only when this is the user's latest workout, like a
        // live web finish. An older session synced late is history, like a
        // backdated log/past entry, and must not move the pointer.
        const { data: newer, error } = await supabase
          .from('sessions')
          .select('id')
          .eq('user_id', userId)
          .not('completed_at', 'is', null)
          .gt('completed_at', completedAt)
          .neq('id', sessionId)
          .limit(1)
        if (error) throw error
        if (newer && newer.length > 0) return
        await advanceRotationAfterFinish(supabase, userId, workoutId, sessionId)
      } catch (err) {
        // Not fatal: resolveRotationIndex catches up from the completion later.
        log('rotation advance failed', err)
      }
    },
    now: () => new Date(),
    log,
  }
}
