import type { SupabaseClient } from '@supabase/supabase-js'
import {
  COACH_BURST_LIMIT,
  COACH_BURST_WINDOW_MINUTES,
  COACH_DAILY_LIMIT,
} from './constants'

export type CoachQuota = {
  dailyUsed: number
  dailyLimit: number
  dailyRemaining: number
  burstUsed: number
  burstLimit: number
  burstRemaining: number
  /** Admin-only dev toggle (user_profiles.coach_dev_unlimited) — daily/burst caps don't apply. */
  unlimited: boolean
}

export function mapCoachRateLimitError(message: string | undefined): {
  status: 429
  error: string
  code: 'burst' | 'daily'
} | null {
  if (!message) return null
  if (message.includes('COACH_RATE_LIMIT_BURST')) {
    return {
      status: 429,
      code: 'burst',
      error: `Too many messages too quickly. Wait a few minutes (max ${COACH_BURST_LIMIT} per ${COACH_BURST_WINDOW_MINUTES} minutes).`,
    }
  }
  if (message.includes('COACH_RATE_LIMIT_DAILY')) {
    return {
      status: 429,
      code: 'daily',
      error: `Daily coach limit reached (${COACH_DAILY_LIMIT} messages per day). Try again tomorrow.`,
    }
  }
  return null
}

/** Pre-check counts so we fail before spending Gemini tokens when possible. */
export async function getCoachQuota(
  supabase: SupabaseClient,
  userId: string,
  isAdmin: boolean,
): Promise<CoachQuota | null> {
  const now = Date.now()
  const dailySince = new Date(now - 24 * 60 * 60 * 1000).toISOString()
  const burstSince = new Date(
    now - COACH_BURST_WINDOW_MINUTES * 60 * 1000,
  ).toISOString()

  const [daily, burst] = await Promise.all([
    supabase
      .from('coach_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'user')
      .gt('created_at', dailySince),
    supabase
      .from('coach_messages')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('role', 'user')
      .gt('created_at', burstSince),
  ])

  // Table missing or RLS misconfigured — caller should surface apply-migration.
  if (daily.error || burst.error) {
    console.error('[grind] coach quota', daily.error ?? burst.error)
    return null
  }

  const dailyUsed = daily.count ?? 0
  const burstUsed = burst.count ?? 0

  // Only ever meaningful for the admin account — enforce_coach_rate_limit()
  // (docs/sql/34-coach-quota-fixes.sql) independently re-checks is_grind_admin()
  // before honoring the column, so this can't be spoofed by editing the row.
  let unlimited = false
  if (isAdmin) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('coach_dev_unlimited')
      .eq('id', userId)
      .maybeSingle()
    unlimited = !!profile?.coach_dev_unlimited
  }

  return {
    dailyUsed,
    dailyLimit: COACH_DAILY_LIMIT,
    dailyRemaining: Math.max(0, COACH_DAILY_LIMIT - dailyUsed),
    burstUsed,
    burstLimit: COACH_BURST_LIMIT,
    burstRemaining: Math.max(0, COACH_BURST_LIMIT - burstUsed),
    unlimited,
  }
}
