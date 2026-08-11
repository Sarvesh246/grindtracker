import { getLevel } from '@/lib/utils/gamification'
import { localDateKey } from '@/lib/utils/formatting'
import type { UserProfile, LeaderboardEntry, FriendProfile, UserStats, Session } from '@/lib/types'

/**
 * Static "showcase" persona + roster used to disguise the real account when
 * Demo Mode (Profile → Settings → Developer, admin-only) is on — for taking
 * screenshots/recordings without exposing the developer's real name, photo,
 * friends, or workout numbers. Everything here is hardcoded and deterministic
 * (no randomness) so the same fake numbers always render, and every
 * threshold-based badge (streak/workout/PR/level/volume/plate tiers) is
 * derived from the same underlying stat it's displayed next to — never a
 * config bug where a badge looks locked despite the stat already exceeding it.
 *
 * GRIND itself launched May 2026 — every join date below is fixed on or after
 * that (never a floating "N months ago", which would eventually predate the
 * app's own existence). "Recent activity" (last session, calendar, streak
 * run) IS relative to today by design — a demo persona should always look
 * currently active whenever the screenshot is taken.
 */

interface ThresholdInputs {
  longestStreak: number
  totalWorkouts: number
  totalPRs: number
  level: number
  volumeLbs: number
  heaviestSetLbs: number
}

/** Badge ids implied purely by the numeric stats — kept in lockstep with the
 *  tiers in `ALL_BADGES` (src/lib/utils/badges.ts) so a fake profile never
 *  shows a locked badge whose threshold a displayed stat already clears. */
function thresholdBadgeIds(s: ThresholdInputs): string[] {
  const ids: string[] = []
  const tiers: [number, string][][] = [
    [[3, 'streak_3'], [7, 'streak_7'], [14, 'streak_14'], [30, 'streak_30'], [60, 'streak_60']],
    [[10, 'workouts_10'], [50, 'workouts_50'], [100, 'workouts_100'], [200, 'workouts_200'], [365, 'workouts_365']],
    [[5, 'pr_5'], [25, 'pr_25'], [50, 'pr_50'], [100, 'pr_100']],
    [[5, 'level_5'], [10, 'level_10'], [15, 'level_15'], [20, 'level_20']],
    [[100000, 'volume_100k'], [500000, 'volume_500k'], [1000000, 'volume_1m']],
    [[225, 'plates_225'], [315, 'plates_315'], [405, 'plates_405']],
  ]
  const values = [s.longestStreak, s.totalWorkouts, s.totalPRs, s.level, s.volumeLbs, s.heaviestSetLbs]
  tiers.forEach((tierList, i) => {
    for (const [threshold, id] of tierList) if (values[i] >= threshold) ids.push(id)
  })
  if (s.totalWorkouts >= 1) ids.push('first_workout')
  if (s.totalPRs >= 1) ids.push('first_pr')
  return ids
}

interface DemoPerson {
  id: string
  username: string
  displayName: string
  joinedAt: string
  xpTotal: number
  currentStreak: number
  longestStreak: number
  totalWorkouts: number
  totalPRs: number
  totalSets: number
  daysActive: number
  volumeLbs: number
  lifts: { push: number; pull: number; legs: number }
  flavorBadgeIds: string[]
}

/** The developer's own fake persona — joined launch day, ~3 months of history. */
const DEMO_ME: DemoPerson = {
  id: '__demo_me__', // overwritten with the real userId when building a leaderboard
  username: 'alex_rivera',
  displayName: 'Alex Rivera',
  joinedAt: '2026-05-01T12:00:00.000Z',
  xpTotal: 12000,
  currentStreak: 18,
  longestStreak: 24,
  totalWorkouts: 78,
  totalPRs: 45,
  totalSets: 560,
  daysActive: 75,
  volumeLbs: 180000,
  lifts: { push: 185, pull: 205, legs: 245 },
  flavorBadgeIds: [
    'all_three_days', 'weekend_warrior', 'early_bird', 'flawless',
    'rest_day_set', 'not_alone', 'rep_machine', 'weight_tracked',
  ],
}

/** Fake competitors — ranked around DEMO_ME on the overall (XP) leaderboard,
 *  staggered join dates from launch week (May 2026) through last week. */
const DEMO_OTHERS: DemoPerson[] = [
  {
    id: 'demo-maya-chen', username: 'maya_chen', displayName: 'Maya Chen',
    joinedAt: '2026-05-01T12:00:00.000Z', xpTotal: 15500, currentStreak: 22, longestStreak: 30,
    totalWorkouts: 95, totalPRs: 58, totalSets: 690, daysActive: 90,
    volumeLbs: 310000, lifts: { push: 205, pull: 225, legs: 245 },
    flavorBadgeIds: ['all_three_days', 'weekend_warrior', 'not_alone'],
  },
  {
    id: 'demo-diego-ramirez', username: 'diego_ramirez', displayName: 'Diego Ramirez',
    joinedAt: '2026-06-01T12:00:00.000Z', xpTotal: 8600, currentStreak: 6, longestStreak: 15,
    totalWorkouts: 48, totalPRs: 28, totalSets: 340, daysActive: 45,
    volumeLbs: 110000, lifts: { push: 165, pull: 185, legs: 205 },
    flavorBadgeIds: ['not_alone', 'rep_machine'],
  },
  {
    id: 'demo-priya-shah', username: 'priya_shah', displayName: 'Priya Shah',
    joinedAt: '2026-06-10T12:00:00.000Z', xpTotal: 6800, currentStreak: 12, longestStreak: 12,
    totalWorkouts: 40, totalPRs: 20, totalSets: 280, daysActive: 38,
    volumeLbs: 85000, lifts: { push: 125, pull: 145, legs: 165 },
    flavorBadgeIds: ['not_alone', 'weight_tracked'],
  },
  {
    id: 'demo-jordan-blake', username: 'jordan_blake', displayName: 'Jordan Blake',
    joinedAt: '2026-06-20T12:00:00.000Z', xpTotal: 5200, currentStreak: 2, longestStreak: 9,
    totalWorkouts: 30, totalPRs: 14, totalSets: 205, daysActive: 28,
    volumeLbs: 60000, lifts: { push: 145, pull: 165, legs: 185 },
    flavorBadgeIds: ['not_alone'],
  },
  {
    id: 'demo-kenji-sato', username: 'kenji_sato', displayName: 'Kenji Sato',
    joinedAt: '2026-07-01T12:00:00.000Z', xpTotal: 3800, currentStreak: 3, longestStreak: 7,
    totalWorkouts: 22, totalPRs: 9, totalSets: 150, daysActive: 20,
    volumeLbs: 42000, lifts: { push: 105, pull: 125, legs: 145 },
    flavorBadgeIds: ['not_alone'],
  },
  {
    id: 'demo-asha-williams', username: 'asha_williams', displayName: 'Asha Williams',
    joinedAt: '2026-07-15T12:00:00.000Z', xpTotal: 2200, currentStreak: 5, longestStreak: 5,
    totalWorkouts: 14, totalPRs: 5, totalSets: 95, daysActive: 13,
    volumeLbs: 24000, lifts: { push: 85, pull: 105, legs: 115 },
    flavorBadgeIds: [],
  },
  {
    id: 'demo-tyler-brooks', username: 'tyler_brooks', displayName: 'Tyler Brooks',
    joinedAt: '2026-08-01T12:00:00.000Z', xpTotal: 450, currentStreak: 0, longestStreak: 2,
    totalWorkouts: 4, totalPRs: 1, totalSets: 26, daysActive: 4,
    volumeLbs: 6000, lifts: { push: 65, pull: 75, legs: 85 },
    flavorBadgeIds: [],
  },
]

function personBadgeIds(p: DemoPerson): string[] {
  const level = getLevel(p.xpTotal)
  const heaviestSetLbs = Math.max(p.lifts.push, p.lifts.pull, p.lifts.legs)
  const derived = thresholdBadgeIds({
    longestStreak: p.longestStreak,
    totalWorkouts: p.totalWorkouts,
    totalPRs: p.totalPRs,
    level,
    volumeLbs: p.volumeLbs,
    heaviestSetLbs,
  })
  return Array.from(new Set([...derived, ...p.flavorBadgeIds]))
}

/** Identity shown in place of the real account across Profile/Home/Settings. */
export const DEMO_IDENTITY = {
  displayName: DEMO_ME.displayName,
  username: DEMO_ME.username,
  avatarUrl: null as string | null,
}

/** Fixed — matches GRIND's real launch date, never drifts with "today". */
export const DEMO_JOINED_AT = DEMO_ME.joinedAt

export const DEMO_STATS = {
  xp_total: DEMO_ME.xpTotal,
  level: getLevel(DEMO_ME.xpTotal),
  current_streak: DEMO_ME.currentStreak,
  longest_streak: DEMO_ME.longestStreak,
  total_workouts: DEMO_ME.totalWorkouts,
}

export const DEMO_TOTAL_PRS = DEMO_ME.totalPRs
export const DEMO_TOTAL_SETS = DEMO_ME.totalSets
export const DEMO_DAYS_ACTIVE = DEMO_ME.daysActive
export const DEMO_BADGE_IDS: string[] = personBadgeIds(DEMO_ME)

type Category = 'push' | 'pull' | 'legs' | 'overall'

/** Mirrors `get_leaderboard` — real userId spliced in for "me" so isMe/rank/
 *  tap-through logic in LeaderboardClient keeps working unmodified. */
export function buildDemoLeaderboard(category: Category, realUserId: string): LeaderboardEntry[] {
  const people = [{ ...DEMO_ME, id: realUserId }, ...DEMO_OTHERS]
  return people
    .map(p => ({
      user_id: p.id,
      username: p.username,
      display_name: p.displayName,
      avatar_url: null,
      xp_total: p.xpTotal,
      level: getLevel(p.xpTotal),
      current_streak: p.currentStreak,
      total_workouts: p.totalWorkouts,
      best_lift: category === 'overall' ? 0 : p.lifts[category],
    }))
    .sort((a, b) => (category === 'overall' ? b.xp_total - a.xp_total : b.best_lift - a.best_lift))
}

export const DEMO_FRIEND_USERNAMES = {
  accepted: ['maya_chen', 'diego_ramirez', 'priya_shah', 'jordan_blake', 'kenji_sato'],
  incoming: ['asha_williams'],
  outgoing: ['tyler_brooks'],
}

function toUserProfile(p: DemoPerson): UserProfile {
  return {
    id: p.id,
    username: p.username,
    display_name: p.displayName,
    avatar_url: null,
    created_at: p.joinedAt,
  }
}

function findPerson(username: string): DemoPerson | undefined {
  return DEMO_OTHERS.find(p => p.username === username)
}

export const DEMO_FRIENDS: { friendship_id: string; profile: UserProfile }[] =
  DEMO_FRIEND_USERNAMES.accepted
    .map(findPerson)
    .filter((p): p is DemoPerson => !!p)
    .map(p => ({ friendship_id: `demo-friend-${p.username}`, profile: toUserProfile(p) }))

export const DEMO_PENDING_INCOMING: { friendship_id: string; profile: UserProfile }[] =
  DEMO_FRIEND_USERNAMES.incoming
    .map(findPerson)
    .filter((p): p is DemoPerson => !!p)
    .map(p => ({ friendship_id: `demo-pending-${p.username}`, profile: toUserProfile(p) }))

export const DEMO_SENT: { friendship_id: string; profile: UserProfile }[] =
  DEMO_FRIEND_USERNAMES.outgoing
    .map(findPerson)
    .filter((p): p is DemoPerson => !!p)
    .map(p => ({ friendship_id: `demo-sent-${p.username}`, profile: toUserProfile(p) }))

/** Full stat block for each fake person's read-only /leaderboard/[username] page. */
export const DEMO_FRIEND_PROFILES: Record<string, FriendProfile> = Object.fromEntries(
  DEMO_OTHERS.map(p => [
    p.username,
    {
      user_id: p.id,
      username: p.username,
      display_name: p.displayName,
      avatar_url: null,
      joined_at: p.joinedAt,
      xp_total: p.xpTotal,
      level: getLevel(p.xpTotal),
      current_streak: p.currentStreak,
      longest_streak: p.longestStreak,
      total_workouts: p.totalWorkouts,
      total_prs: p.totalPRs,
      total_sets: p.totalSets,
      days_active: p.daysActive,
      badge_ids: personBadgeIds(p),
    } satisfies FriendProfile,
  ])
)

// ── Home dashboard / calendar / body-weight fixtures ────────────────────────
// These are computed relative to "now" (unlike the fixed join dates above) —
// a demo persona should always look currently active whenever the screenshot
// is taken, not frozen at whatever moment the code was written.

const DAY_CYCLE = ['push', 'pull', 'legs'] as const

interface DemoWorkoutDay {
  date: string // YYYY-MM-DD local date key
  dayType: string
}

/** A believable ~5-day/week history: the current streak run ending
 *  yesterday (so "start today's workout" still reads naturally), plus
 *  scattered earlier sessions for weekly/monthly counts and the calendar. */
function demoRecentWorkoutDays(lookbackDays = 60): DemoWorkoutDay[] {
  const days: DemoWorkoutDay[] = []
  const anchor = new Date()
  anchor.setDate(anchor.getDate() - 1) // streak run ends yesterday
  for (let i = 0; i < DEMO_ME.currentStreak; i++) {
    const d = new Date(anchor)
    d.setDate(d.getDate() - i)
    days.push({ date: localDateKey(d), dayType: DAY_CYCLE[i % 3] })
  }
  for (let i = DEMO_ME.currentStreak; i < lookbackDays; i++) {
    if (i % 7 === 5 || i % 7 === 6) continue // two rest days/week
    const d = new Date(anchor)
    d.setDate(d.getDate() - i)
    days.push({ date: localDateKey(d), dayType: DAY_CYCLE[i % 3] })
  }
  return days
}

/** Recent local-date keys for HomeDashboard's "this week"/"this month" counts. */
export function demoCompletedLocalDates(): string[] {
  return demoRecentWorkoutDays().map(d => d.date)
}

/** date → day_type map for whichever month WorkoutCalendar has navigated to. */
export function demoCalendarWorkoutDays(year: number, month0: number): Record<string, string> {
  const map: Record<string, string> = {}
  for (const { date, dayType } of demoRecentWorkoutDays()) {
    const [y, m] = date.split('-').map(Number)
    if (y === year && m === month0 + 1) map[date] = dayType
  }
  return map
}

/** Fake "last completed session" for the home dashboard's last-workout band. */
export function demoLastSession(): Session {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  yesterday.setHours(18, 30, 0, 0)
  const dateKey = localDateKey(yesterday)
  return {
    id: 'demo-last-session',
    user_id: '__demo_me__',
    day_type: DAY_CYCLE[0],
    started_at: yesterday.toISOString(),
    completed_at: yesterday.toISOString(),
    local_date: dateKey,
    xp_earned: 125,
    note: null,
    created_at: yesterday.toISOString(),
  }
}

export const DEMO_LAST_SESSION_LOGS: { exercise_name: string; weight: number | null; sets: number; reps: number | null }[] = [
  { exercise_name: 'Bench Press', weight: 185, sets: 4, reps: 6 },
  { exercise_name: 'Overhead Press', weight: 105, sets: 3, reps: 8 },
  { exercise_name: 'Incline Dumbbell Press', weight: 60, sets: 3, reps: 10 },
  { exercise_name: 'Triceps Pushdown', weight: 45, sets: 3, reps: 12 },
]

/** `user_stats`-shaped row for callers (HomeDashboard) that need the full table shape. */
export function demoHomeStats(): UserStats {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return {
    id: 'demo-stats',
    user_id: '__demo_me__',
    xp_total: DEMO_STATS.xp_total,
    level: DEMO_STATS.level,
    current_streak: DEMO_STATS.current_streak,
    longest_streak: DEMO_STATS.longest_streak,
    last_workout_date: localDateKey(yesterday),
    total_workouts: DEMO_STATS.total_workouts,
    created_at: DEMO_JOINED_AT,
    updated_at: new Date().toISOString(),
  }
}

/** Fake `body_weights` rows (canonical lbs) — a mild ~90-day recomposition trend. */
export function demoBodyWeightRows(): { weight: number; recorded_at: string }[] {
  const START_LBS = 182
  const END_LBS = 176
  const POINTS = 13
  const rows: { weight: number; recorded_at: string }[] = []
  for (let i = 0; i < POINTS; i++) {
    const daysAgo = Math.round(90 - (i * 90) / (POINTS - 1))
    const d = new Date()
    d.setDate(d.getDate() - daysAgo)
    const t = i / (POINTS - 1)
    const weight = Math.round((START_LBS + (END_LBS - START_LBS) * t) * 10) / 10
    rows.push({ weight, recorded_at: localDateKey(d) })
  }
  return rows
}
