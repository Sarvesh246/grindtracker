import type { SupabaseClient } from '@supabase/supabase-js'
import { localDateKey } from '@/lib/utils/formatting'
import { DEMO_STATS } from './fakeData'

/**
 * Every RPC in the app that mutates data (see CLAUDE.md's stats-RPC table
 * plus start_or_resume_session/upsert_past_session/award_earned_badges,
 * confirmed against docs/sql/20-production-hardening.sql and
 * docs/sql/11-parts/*.sql). Read-only RPCs (get_leaderboard,
 * grind_home_history, get_exercise_last_weights, ...) are deliberately not
 * listed here and pass straight through to the real client.
 */
const MUTATING_RPCS = new Set([
  'start_or_resume_session',
  'complete_session',
  'uncomplete_session',
  'award_earned_badges',
  'upsert_past_session',
  'delete_session',
  'refresh_stats',
  'toggle_rest_today',
  'set_rest_weekday',
])

const MUTATING_TABLE_METHODS = new Set(['insert', 'upsert', 'update', 'delete'])

const CHAIN_METHODS = [
  'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is',
  'in', 'not', 'or', 'order', 'limit', 'range', 'maybeSingle', 'single',
]

/** A thenable stand-in for a Postgrest builder that always "succeeds" with
 *  no network call — every chain method just returns itself, and awaiting
 *  it resolves to `{ data, error: null }`. */
function noopBuilder(data: unknown = null) {
  const builder: Record<string, unknown> = {
    then(resolve: (v: { data: unknown; error: null }) => void) {
      resolve({ data, error: null })
    },
  }
  for (const method of CHAIN_METHODS) builder[method] = () => builder
  return builder
}

function fakeRpcData(fnName: string, args: Record<string, unknown> | undefined): unknown {
  const today = localDateKey()
  switch (fnName) {
    case 'start_or_resume_session': {
      const dayType = (args?.p_day_type as string | undefined) ?? 'push'
      const now = new Date().toISOString()
      return {
        session: {
          id: 'demo-session',
          user_id: 'demo',
          day_type: dayType,
          started_at: now,
          completed_at: null,
          local_date: null,
          xp_earned: 0,
          note: null,
          created_at: now,
        },
        logs: [],
        resumed: false,
      }
    }
    case 'complete_session':
      return {
        xp_earned: 125,
        xp_total: DEMO_STATS.xp_total,
        prev_level: DEMO_STATS.level,
        level: DEMO_STATS.level,
        leveled_up: false,
        current_streak: DEMO_STATS.current_streak,
        longest_streak: DEMO_STATS.longest_streak,
        last_workout_date: today,
        total_workouts: DEMO_STATS.total_workouts,
        pr_count: 0,
        pr_exercises: [],
      }
    case 'uncomplete_session':
    case 'delete_session':
      return {
        xp_total: DEMO_STATS.xp_total,
        level: DEMO_STATS.level,
        current_streak: DEMO_STATS.current_streak,
        total_workouts: DEMO_STATS.total_workouts,
      }
    case 'refresh_stats':
      return {
        xp_total: DEMO_STATS.xp_total,
        level: DEMO_STATS.level,
        current_streak: DEMO_STATS.current_streak,
        longest_streak: DEMO_STATS.longest_streak,
        total_workouts: DEMO_STATS.total_workouts,
        last_workout_date: today,
      }
    case 'upsert_past_session':
      return {
        session_id: 'demo-session',
        xp_earned: 100,
        xp_total: DEMO_STATS.xp_total,
        level: DEMO_STATS.level,
        current_streak: DEMO_STATS.current_streak,
        longest_streak: DEMO_STATS.longest_streak,
        last_workout_date: today,
        total_workouts: DEMO_STATS.total_workouts,
        pr_count: 0,
        is_edit: true,
      }
    case 'award_earned_badges':
      return []
    case 'toggle_rest_today':
      return { rest: true, undone: false }
    case 'set_rest_weekday':
      return { enabled: true }
    default:
      return null
  }
}

/**
 * Wraps a real Supabase client so every write (insert/upsert/update/delete on
 * any table, plus any RPC known to mutate) becomes a local no-op that
 * resolves as if it succeeded — nothing ever reaches the network, so a
 * screenshot-only workout/body-weight edit done while Demo Mode is on can
 * never touch the real account's data. Reads pass straight through to the
 * real client, so the UI still populates with real exercise catalogs, rest
 * timers, etc. — only persistence is faked.
 */
export function demoSafeClient(real: SupabaseClient): SupabaseClient {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'from') {
        return (table: string) => {
          const realBuilder = (target as unknown as { from: (t: string) => unknown }).from(table)
          return new Proxy(realBuilder as object, {
            get(bTarget, bProp, bReceiver) {
              if (typeof bProp === 'string' && MUTATING_TABLE_METHODS.has(bProp)) {
                return () => noopBuilder(null)
              }
              const value = Reflect.get(bTarget, bProp, bReceiver)
              return typeof value === 'function' ? value.bind(bTarget) : value
            },
          })
        }
      }
      if (prop === 'rpc') {
        return (fnName: string, args?: Record<string, unknown>) => {
          if (MUTATING_RPCS.has(fnName)) return noopBuilder(fakeRpcData(fnName, args))
          return (target as unknown as { rpc: (n: string, a?: Record<string, unknown>) => unknown }).rpc(fnName, args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
