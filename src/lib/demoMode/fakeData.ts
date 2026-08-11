import { getLevel } from '@/lib/utils/gamification'
import type { UserProfile, LeaderboardEntry, FriendProfile } from '@/lib/types'

/**
 * Static "showcase" persona + roster used to disguise the real account when
 * Demo Mode (Profile → Settings → Developer, admin-only) is on — for taking
 * screenshots/recordings without exposing the developer's real name, photo,
 * or friends. Everything here is hardcoded and deterministic (no randomness)
 * so the same fake numbers always render, and every threshold-based badge
 * (streak/workout/PR/level/volume/plate tiers) is derived from the same
 * underlying stat it's displayed next to — never a config bug where a badge
 * looks locked despite the stat already exceeding it.
 */

function monthsAgo(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return d.toISOString()
}

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

/** The developer's own fake persona. */
const DEMO_ME: DemoPerson = {
  id: '__demo_me__', // overwritten with the real userId when building a leaderboard
  username: 'alex_rivera',
  displayName: 'Alex Rivera',
  joinedAt: monthsAgo(11),
  xpTotal: 46000,
  currentStreak: 33,
  longestStreak: 52,
  totalWorkouts: 214,
  totalPRs: 75,
  totalSets: 1650,
  daysActive: 201,
  volumeLbs: 650000,
  lifts: { push: 225, pull: 245, legs: 275 },
  flavorBadgeIds: [
    'all_three_days', 'weekend_warrior', 'early_bird', 'flawless',
    'rest_day_set', 'not_alone', 'rep_machine', 'weight_tracked',
  ],
}

/** Fake competitors — ranked around DEMO_ME on the overall (XP) leaderboard. */
const DEMO_OTHERS: DemoPerson[] = [
  {
    id: 'demo-maya-chen', username: 'maya_chen', displayName: 'Maya Chen',
    joinedAt: monthsAgo(14), xpTotal: 52000, currentStreak: 40, longestStreak: 65,
    totalWorkouts: 240, totalPRs: 88, totalSets: 1820, daysActive: 225,
    volumeLbs: 900000, lifts: { push: 245, pull: 265, legs: 315 },
    flavorBadgeIds: ['all_three_days', 'weekend_warrior', 'not_alone'],
  },
  {
    id: 'demo-diego-ramirez', username: 'diego_ramirez', displayName: 'Diego Ramirez',
    joinedAt: monthsAgo(9), xpTotal: 39500, currentStreak: 5, longestStreak: 21,
    totalWorkouts: 190, totalPRs: 60, totalSets: 1440, daysActive: 178,
    volumeLbs: 520000, lifts: { push: 205, pull: 225, legs: 275 },
    flavorBadgeIds: ['not_alone', 'rep_machine'],
  },
  {
    id: 'demo-priya-shah', username: 'priya_shah', displayName: 'Priya Shah',
    joinedAt: monthsAgo(8), xpTotal: 33000, currentStreak: 18, longestStreak: 18,
    totalWorkouts: 165, totalPRs: 48, totalSets: 1240, daysActive: 150,
    volumeLbs: 410000, lifts: { push: 155, pull: 185, legs: 225 },
    flavorBadgeIds: ['not_alone', 'weight_tracked'],
  },
  {
    id: 'demo-jordan-blake', username: 'jordan_blake', displayName: 'Jordan Blake',
    joinedAt: monthsAgo(6), xpTotal: 27800, currentStreak: 2, longestStreak: 14,
    totalWorkouts: 140, totalPRs: 35, totalSets: 1020, daysActive: 120,
    volumeLbs: 300000, lifts: { push: 185, pull: 205, legs: 225 },
    flavorBadgeIds: ['not_alone'],
  },
  {
    id: 'demo-kenji-sato', username: 'kenji_sato', displayName: 'Kenji Sato',
    joinedAt: monthsAgo(5), xpTotal: 21000, currentStreak: 3, longestStreak: 10,
    totalWorkouts: 110, totalPRs: 22, totalSets: 780, daysActive: 95,
    volumeLbs: 210000, lifts: { push: 135, pull: 165, legs: 185 },
    flavorBadgeIds: ['not_alone'],
  },
  {
    id: 'demo-asha-williams', username: 'asha_williams', displayName: 'Asha Williams',
    joinedAt: monthsAgo(4), xpTotal: 15600, currentStreak: 9, longestStreak: 9,
    totalWorkouts: 85, totalPRs: 15, totalSets: 560, daysActive: 70,
    volumeLbs: 140000, lifts: { push: 115, pull: 135, legs: 165 },
    flavorBadgeIds: [],
  },
  {
    id: 'demo-tyler-brooks', username: 'tyler_brooks', displayName: 'Tyler Brooks',
    joinedAt: monthsAgo(2), xpTotal: 9800, currentStreak: 0, longestStreak: 6,
    totalWorkouts: 52, totalPRs: 8, totalSets: 310, daysActive: 45,
    volumeLbs: 70000, lifts: { push: 95, pull: 115, legs: 135 },
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
