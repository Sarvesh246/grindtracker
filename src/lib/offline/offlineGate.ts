import type { SupabaseClient } from '@supabase/supabase-js'
import { hasPendingLocalSession } from './localSession'

/** Marker on the synthetic error so retry loops can skip their backoff. */
export const OFFLINE_ERROR_MESSAGE = 'GRIND_OFFLINE'

export function isOfflineError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { message?: unknown }).message === OFFLINE_ERROR_MESSAGE
  )
}

export function browserIsOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/**
 * Should a `session_logs` write skip the network and go straight to the
 * offline queue? Yes when the browser reports no connection, and also while the
 * session only exists on this device — the server would reject those rows with a
 * foreign-key error, which the app (correctly) treats as permanent.
 */
export function shouldQueueInsteadOfSend(): boolean {
  return browserIsOffline() || hasPendingLocalSession()
}

const CHAIN_METHODS = [
  'select', 'insert', 'upsert', 'update', 'delete', 'eq', 'neq', 'gt', 'gte', 'lt',
  'lte', 'is', 'in', 'not', 'or', 'order', 'limit', 'range', 'maybeSingle', 'single',
]

/** Thenable that behaves like a Postgrest builder but resolves to a transient error. */
export function offlineBuilder() {
  const result = {
    data: null,
    error: { message: OFFLINE_ERROR_MESSAGE, code: '', details: '', hint: '' },
  }
  const builder: Record<string, unknown> = {
    then(resolve: (v: typeof result) => void) {
      resolve(result)
    },
  }
  for (const m of CHAIN_METHODS) builder[m] = () => builder
  return builder
}

/**
 * Wrap a client so `session_logs` writes made while offline (or against a
 * not-yet-synced local session) fail instantly with a transient error. Callers
 * already turn transient failures into queued ops, so no request is attempted
 * and no timeout is waited out. Reads and RPCs pass through untouched.
 */
export function withOfflineGate(
  client: SupabaseClient,
  shouldQueue: () => boolean = shouldQueueInsteadOfSend,
): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'from') {
        return (table: string) =>
          table === 'session_logs' && shouldQueue()
            ? offlineBuilder()
            : target.from(table)
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

/**
 * Offline, every table read and RPC fails immediately with a transient error.
 *
 * Without this each call first asks the auth layer for a token, and an expired
 * token can't refresh with no network — supabase-js then retries for up to
 * ~30s before giving up, and every screen that loads data sits on that. Failing
 * fast lets the offline fallbacks (saved catalog, cached query data) paint
 * straight away.
 */
export function withOfflineFastFail(client: SupabaseClient): SupabaseClient {
  return new Proxy(client, {
    get(target, prop) {
      if ((prop === 'from' || prop === 'rpc') && browserIsOffline()) {
        return () => offlineBuilder()
      }
      const value = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
