# Gamification, badges, stats and failed reads

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Gamification (src/lib/utils/gamification.ts)
XP: +100 per completed workout (needs ≥1 non-warmup working set — migration
`40`; warm-up-only sessions cannot finish), +25 per PR set, +50 when the new
streak hits a multiple of 7. Warm-up sets never count toward PRs.
Level: triangular curve — XP to advance from level n to n+1 is `500 * n`, so
cumulative XP for level n is `500 * n * (n-1) / 2`. `getLevel(xp)` inverts this.
Streak: continues on consecutive calendar days (gap of exactly 1 day
increments; same day keeps it), OR across a gap where every day in between is
a configured rest day (recurring or one-off confirmed — see Rest days in [WORKOUT-LOGIC.md](WORKOUT-LOGIC.md));
any other gap resets to 1. Home page zeroes a stale streak when the gap since
the last workout isn't fully covered by rest days.
PR: weight × reps (volume) > max non-warm-up volume in any previous completed
session for that exercise (migration `15-volume-based-prs.sql`). The first
completed session for an exercise is the baseline, not a PR (migration `51`).

## Badges (src/lib/utils/badges.ts)
57 badges — streak/workout-count/PR-count/level tiers, plus lifetime volume
(100K/500K/1M Club), plate milestones (Two/Three/Four Plates — a single set's
heaviest weight), time-of-day (early bird/night owl), weekend warrior, a
comeback badge (14+ day gap since the prior workout), flawless (a session with
zero skipped sets), rest-day/friend/body-weight-log config badges, and a
`completionist` meta-badge for earning every other one. Migration `57` added 22
more (57 total): consistency (Perfect Week, Saved It, Rest Day Pro, early/night
"Regular"), training quality, Hat Trick / Podium Push, body (14-day weigh-in,
Goal Getter = beat `exercises.weight_target` on 3 lifts, 5 progress photos),
social (5 friends, leaderboard top-3 / #1 over self + friends), and app events
(offline-started session, Coach weekly plan, US federal holiday, data export,
feedback). The rules live in `grind_award_badges_for(user)` — internal only,
`award_earned_badges()` wraps it for `auth.uid()` — so 57 could backfill every
account. **Adding a badge: redefine that function starting from 57, add it to
`v_all_but_completionist`, `ALL_BADGES`, and a `BadgeIcon` case, and end the
migration with the same backfill loop.** `profile/page.tsx` also runs
`award_earned_badges()` on every visit so non-workout badges land promptly.
`checkAndAwardBadges()`
calls `award_earned_badges()` with no client hour/skip args (migration `38`).
Early bird / night owl / flawless are derived server-side from
`sessions.start_hour` (set by `complete_session`, same trust model as
`p_local_date`) and skip rows on live-completed sessions — past-logged
workouts leave `start_hour` null so those three badges do not apply there.
Lifetime aggregates (volume, heaviest/highest-rep set, exercise variety,
rest-day/friend/weight-log flags) come from one RPC, `grind_badge_metrics()`
(migration `16-badge-metrics.sql`) — not security definer, every subquery
filters on `auth.uid()` directly, so it can only ever report the caller's own
data. `BadgeIcon` (src/components/BadgeIcon.tsx) is the single shared
hand-drawn icon set — used by the profile badge grid, and the completion flow.

On the live-finish path only, newly earned badges show as a full-screen
`BadgeUnlockOverlay` (src/components/BadgeUnlockOverlay.tsx) BEFORE
`CompletionModal` — `ActiveWorkout` renders one or the other, never both, and
`CompletionModal` itself no longer has its own "badges earned" section (would
just repeat the overlay a tap later). The other two callers award badges
silently in the background with no popup, matching their own "skip the
celebratory modal" design.

**Stats are server-authoritative (migration `11-server-side-xp.sql`).** The rules
above are now implemented in Postgres, not the browser. `grind_recompute_stats()`
DERIVES xp/level/streaks/`is_pr` from `sessions` + `session_logs` — nothing is
stored that isn't recomputable — and the client has **no UPDATE privilege on
`user_stats`** at all. Never reintroduce a direct write; go through the RPCs:

| RPC | Called from |
| --- | --- |
| `complete_session(session_id, local_date, note, start_hour, utc_offset_minutes)` | `ActiveWorkout.handleFinish` |
| `uncomplete_session(session_id, local_date)` | `ActiveWorkout.handleUndoFinish`, `FinishUndoBanner` |
| `delete_session(session_id, local_date)` | `log/past` delete |
| `refresh_stats(local_date)` | `log/past` save, `HomeDashboard` stale-streak lapse |
| `toggle_rest_today(local_date)` | `HomeDashboard` Rest today / undo |
| `set_rest_weekday(day_of_week, enabled, local_date)` | Settings + onboarding rest-day pills |

`src/lib/utils/gamification.ts` still holds `getLevel`/`getXpInCurrentLevel` etc.
for DISPLAY. `grind_level_for_xp()` in SQL mirrors `getLevel` — **change one,
change both.** Every RPC takes `p_local_date` because streaks depend on the
user's calendar day and Postgres only sees UTC; it's clamped to ±1 day of UTC so
it can't be used to farm streak bonuses. `sessions.local_date` stores it.

## Failed reads vs. empty accounts
A dropped Supabase read returns `{ data: null }`, and dashboard reads are
destructured as `{ data }` with the error discarded — so one transient failure
among the home page's dozen parallel reads rendered an established user the
FIRST-RUN dashboard: welcome hero, level 0, streak 0, "log your first session".
Reopening the app "fixed" it, which is exactly what made it read as data loss.
Two rules keep it from coming back:

- Reads that decide *"is this a returning user"* go through `readWithRetry`
  (`src/lib/supabase/readWithRetry.ts`) — one retry, then `reportError`, never a
  silent empty result.
- **A launch never shows a stats error if it can help it.** The server retries
  (3 attempts), then `HomeDashboard` recovers client-side: it re-reads
  `user_stats` from the browser client (its own connection and token, so it
  usually succeeds where the server render just failed) and, in parallel,
  paints the user's last-known level/streak from `grind_last_stats` in
  localStorage (`src/lib/cache/lastKnownStats.ts`, keyed to the user id and
  cleared on sign-out beside `resetAppDataCache()`). A shimmer covers the gap.
  The "couldn't load your stats" card with its RETRY is the terminal state
  only — server, client, and cache all failed — not the first thing a flaky
  launch shows.
- **A missing `user_stats` row is a failed read, never a new user.** Every
  account is seeded one at signup (`grind_seed_user_stats`, migration `11`) and
  the client has no insert/delete on it, so `stats == null` can only mean the
  read failed. `home/page.tsx` passes `statsUnavailable`; `HomeDashboard` shows a
  "couldn't load your stats" card with a retry instead of zeros, and every
  first-run branch (hero, streak card, primary CTA, tour steps, overdue nudge) is
  gated on `isNewUser` = `!!effectiveStats && totalWorkouts === 0` — never on
  `totalWorkouts === 0` alone. `restDataUnavailable` is the same idea for the
  rest-day reads: without those rows every gap looks uncovered, and the client
  would zero a streak the user never broke.
