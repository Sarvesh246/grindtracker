# GRIND — Gym Tracker

## Status: COMPLETE ✅
All core phases (1–7) built and deployed. Single-user PWA, in daily use.

## Stack
Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4,
Supabase (@supabase/ssr), Recharts, deployed on Vercel.

> ⚠️ Next.js 16 has breaking changes vs. earlier versions (APIs, conventions,
> file structure). It may differ from training data — consult
> `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).

Commands: `npm run dev` (dev server), `npm run build` (production build, see below),
`npm start` (serve build), `npm run lint` (ESLint).

### Building locally
`npm run build` uses Turbopack, which requires native SWC bindings. In sandboxes
without them (e.g. musl/WASM-only), build with `npx next build --webpack`.
The build statically prerenders client pages, so `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` must be set for the build to succeed (Vercel sets
these automatically; locally export placeholders to verify a build).

## Design System
Background: #0f0f0f | Surface: #1a1a1a | Surface elevated: #242424
Border: #2e2e2e | Accent: #c8f135 | Accent dim: #8faa24
Text primary: #f0f0f0 | Text secondary: #888888 | Text muted: #555555
Danger: #ef4444

Fonts: Bebas Neue (display), DM Sans (body), JetBrains Mono (numbers)
Border radius: 12px standard, 8px small, 9999px pill
Transitions: 150ms ease
Primary button: bg #c8f135, text #0f0f0f, font bold
Secondary button: bg #242424, text #f0f0f0, border #2e2e2e

### Theming (dark default + light mode)
All colors are CSS vars in `src/app/globals.css`. The dark palette lives in
`:root`; the light palette overrides the same mirror vars under `html.light`.
Theme is dark by default and persisted via the `grind_theme_pref` cookie
(+ localStorage) by `ThemeContext` — mirroring `UnitContext`. The root layout
(`src/app/layout.tsx`) reads the cookie server-side and sets `<html class="light">`
so there's no flash. Toggle UI: circular sun/moon `ThemeToggle` beside the kg/lb
toggle in TopNav and Profile settings.
**Convention:** the lime `--accent` is a FILL, unchanged in both themes. For lime
TEXT/icons that must read on white, use `--accent-text` (lime in dark, olive
`#5f7a16` in light) — never `--accent` for text color. Faint accent panel
backgrounds use `--accent-wash`; cards read `--card-shadow` (none in dark). The
leaderboard ShareCard and the favicon stay dark-branded (`.share-card-dark` pins
the dark tokens regardless of theme).

### Reduced motion
Mirrors the theming pattern exactly: `MotionContext` persists an explicit
in-app "Reduce Motion" preference via the `grind_motion_pref` cookie (+
localStorage), the root layout resolves it server-side and sets
`<html class="reduce-motion">` (alongside `.light`) so there's no flash, and a
switch in Profile → Settings toggles it. This is layered ON TOP of the
OS-level `prefers-reduced-motion` media query in `globals.css`, not a
replacement for it — `html.reduce-motion` gets the identical zero-duration
treatment as the media query, for anyone who wants animations off in-app
without changing their whole system.

`html.reduce-motion` only reaches CSS-driven animation (transitions/keyframes),
which covers every animation in the app except one: the Recharts `<Line>`
draw-in on the progress and body-weight charts is a JS (react-smooth)
animation the CSS class can't touch. Those two call sites (`ProgressChart.tsx`,
`BodyWeightCard.tsx`) read `useMotionPref().reduceMotion` directly and pass
`isAnimationActive={!reduceMotion}` to opt out explicitly — any future chart
needs the same treatment, since neither the media query nor the `.reduce-motion`
class does it automatically.

### Responsive navigation
`TopNav` (desktop) and `BottomNav` (mobile) both render in `(app)/layout.tsx`;
CSS at the 768px breakpoint shows exactly one — there is no JS width detection.
Both share `UnitContext`, so the kg/lbs toggle stays in sync across them.

## Supabase Tables
- exercises — user_id, name, day_type, sets_target, reps_target, sort_order,
  active (default true). Per-user catalog (RLS, owner-only): each user builds &
  edits their own days & exercises; a new user starts with a blank slate (no
  seeded days). See migration `07-exercises-per-user.sql`. `active=false`
  disables the exercise for that day — toggled from WorkoutManager's day
  screen — without deleting it (keeps history/PR bar). ActiveWorkout's
  `initSession` and `log/past`'s `loadExercises` both filter to active
  exercises for a NEW entry, but keep any exercise the resuming/edited
  session already has logs for even if it's since been disabled since then.
  This matters most for `log/past`: an edit there deletes and re-inserts
  every one of the session's logs from what's on screen, so dropping a
  since-disabled exercise from the form would silently erase its history on
  save. ActiveWorkout never does a wholesale replace, so the same filter is
  really just about not hiding a set the user can still finish mid-session.
  See migration `17-exercise-active-flag.sql`.
- sessions — user_id, day_type, started_at, completed_at, xp_earned, note
- session_logs — session_id, exercise_id, set_number, weight, reps, is_pr,
  is_warmup, note, is_skipped (default false). UNIQUE on (session_id,
  exercise_id, set_number). `is_skipped` rows are markers (weight/reps always
  null, enforced by a CHECK) that let a skipped set in ActiveWorkout survive
  closing/resuming the app — see Skip persistence below and migration
  `18-skip-persistence.sql`.
- user_stats — xp_total, level, current_streak, longest_streak,
  last_workout_date, total_workouts
- user_badges — user_id, badge_id, earned_at
- body_weights — user_id, weight, recorded_at (date). UNIQUE (user_id, recorded_at).
- user_profiles — id (= auth uid), username (unique), display_name, avatar_url
- friendships — requester_id, addressee_id, status ('pending' | 'accepted')
- user_day_categories — (user_id, day_key) → category ('push'|'pull'|'legs'|'other'),
  maps custom day names to leaderboard tabs.
- user_rotation — user_id (PK), mode ('auto'|'manual'), sequence (jsonb array of
  day_keys, may repeat), current_index (pointer to last completed slot). Drives the
  home page's suggested next day. See Rotation below.
- feedback — user_id, username/email (identity snapshot at submit time),
  category ('bug'|'feature'|'improvement'|'other'), message, image_paths (text[]
  of objects in the private `feedback-images` bucket), is_anonymous, is_read,
  is_starred. See Feedback below and migration `09-feedback.sql`.
- user_rest_days — (user_id, day_of_week) PK, recurring weekly rest days
  (0=Sun..6=Sat, matches `extract(dow)`/`Date.getDay()`), configured in
  Profile. user_rest_dates — (user_id, rest_date) PK, one-off confirmed rest
  dates (retroactive "missed a day?" confirmation from the home dashboard, or
  set directly). Both single-owner tables, RLS-protected. See Rest days below
  and migration `14-rest-days.sql`.
RLS on exercises, sessions, session_logs, user_stats, user_badges, body_weights,
user_day_categories, user_rotation, feedback, user_rest_days, user_rest_dates
(and delete policies on sessions/session_logs for discard).
`get_leaderboard(p_day_type, p_user_ids)` RPC ranks overall by XP, or
push/pull/legs by heaviest working-set lift (category-aware, security definer).

Schema migrations live in `docs/sql/` (idempotent; apply in order via the
Supabase SQL editor). See `docs/SQL.md`.

## Gamification (src/lib/utils/gamification.ts)
XP: +100 per completed workout, +25 per PR set, +50 when the new streak hits a
multiple of 7. Warm-up sets never count toward PRs.
Level: triangular curve — XP to advance from level n to n+1 is `500 * n`, so
cumulative XP for level n is `500 * n * (n-1) / 2`. `getLevel(xp)` inverts this.
Streak: continues on consecutive calendar days (gap of exactly 1 day
increments; same day keeps it), OR across a gap where every day in between is
a configured rest day (recurring or one-off confirmed — see Rest days below);
any other gap resets to 1. Home page zeroes a stale streak when the gap since
the last workout isn't fully covered by rest days.
PR: weight × reps (volume) > max non-warm-up volume in any previous completed
session for that exercise (migration `15-volume-based-prs.sql`).

## Badges (src/lib/utils/badges.ts)
35 badges — streak/workout-count/PR-count/level tiers, plus lifetime volume
(100K/500K/1M Club), plate milestones (Two/Three/Four Plates — a single set's
heaviest weight), time-of-day (early bird/night owl), weekend warrior, a
comeback badge (14+ day gap since the prior workout), flawless (a session with
zero skipped sets), rest-day/friend/body-weight-log config badges, and a
`completionist` meta-badge for earning every other one. `checkAndAwardBadges()`
takes an optional `BadgeContext` (`sessionStartedAt`, `hadNoSkips`) for the
session-local conditions — only `ActiveWorkout.handleFinish` (the live-finish
path) passes both; `HomeDashboard`'s quick-save passes just the start time;
`log/past` (backdated entries) passes neither, since time-of-day and
"skipped a set" don't reliably apply to a manually-entered historical workout.
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
| `complete_session(session_id, local_date, note)` | `ActiveWorkout.handleFinish` |
| `uncomplete_session(session_id, local_date)` | `ActiveWorkout.handleUndoFinish`, `FinishUndoBanner` |
| `delete_session(session_id, local_date)` | `log/past` delete |
| `refresh_stats(local_date)` | `log/past` save, `HomeDashboard` stale-streak lapse |

`src/lib/utils/gamification.ts` still holds `getLevel`/`getXpInCurrentLevel` etc.
for DISPLAY. `grind_level_for_xp()` in SQL mirrors `getLevel` — **change one,
change both.** Every RPC takes `p_local_date` because streaks depend on the
user's calendar day and Postgres only sees UTC; it's clamped to ±1 day of UTC so
it can't be used to farm streak bonuses. `sessions.local_date` stores it.

### Security model
- **RLS is the boundary, never the UI.** Route guards (`isAdminEmail`) only pick
  404-vs-render; `is_grind_admin()` in Postgres is the real gate.
- **`security definer` functions bypass RLS**, so each one must authorize its own
  caller and pin `set search_path`. `get_leaderboard` intersects the requested
  ids with the caller's accepted friendships — it previously trusted the client's
  array, which let any user read any other user's stats by uuid (fixed in `10`).
- **Never trust a client-supplied number that feeds a leaderboard.** Derive it.
- **A single `FOR ALL` policy is rarely right for a table two parties share.**
  `friendships` had one, testing only "am I involved in this row" — which let a
  requester accept their own request and let anyone insert a pre-accepted
  friendship naming someone else as requester (fixed in `12`). Split by command
  and assert what each one actually means: who may create, who may approve.
- Security headers (CSP, HSTS, `frame-ancestors 'none'`) live in `next.config.ts`.
- `src/proxy.ts` uses `getClaims()` (local JWKS verification) rather than
  `getUser()` (a network round trip per request), and caches the "profile exists"
  check in the `grind_profile_ok` cookie instead of querying on every navigation.

### Rotation (src/lib/utils/rotation.ts)
The suggested "next day" comes from a per-user rotation — an ordered loop of day_keys
that may repeat (e.g. [push, abs, pull, abs, legs, abs]). `auto` mode derives the order
from the user's days (each once, alphabetical, via `autoSequence`) and fixes the old bug
where custom days fell out of the push→pull→legs cycle; `manual` mode follows the saved
`sequence`, editable in WorkoutManager's "Edit workout order" screen (reorderable slot
list). `home/page.tsx` reads `nextDay(effectiveSequence(row, dayKeys), current_index)`;
`ActiveWorkout.handleFinish` advances `current_index` via `advanceIndex` after a live
completion (backdated `log/past` entries deliberately don't). The suggestion is
non-binding — DaySelect still lets you pick any day, and marks the suggested one "UP NEXT".
Helpers are pure (no Supabase import). Apply migration `06-user-rotation.sql` first.

### Rest days (src/lib/utils/restDays.ts, migration `14-rest-days.sql`)
Two ways to declare a day off without breaking the streak: recurring weekly
rest days (toggled as day-pills in Profile → Settings, backed by
`user_rest_days`) and one-off confirmed rest dates (`user_rest_dates`),
either set the same way or confirmed retroactively via a dismissible "missed
a day?" banner on the home dashboard. The banner only offers to mark a gap as
rest days when the gap is small relative to how many recurring rest days are
already configured (`1 <= uncovered.length <= max(1, recurringRestDays.length)`)
— a bigger gap is just a broken streak, no prompt. Server-side,
`grind_dates_connected(user, from, to)` (SQL) tests whether every day
strictly between two dates is a rest day; `grind_recompute_stats()` uses it
to group workout dates into rest-day-aware "runs" instead of requiring
literally-consecutive calendar dates (see Stats below). `restDays.ts` mirrors
the same connectivity logic in TS (`Date.getDay()` already matches Postgres's
`extract(dow)` convention, 0=Sun..6=Sat, so no translation needed) so the
client can compute gaps and eligible banner state using the viewer's own
local "today" — never the server's, per Dates & timezones below.

### Skip persistence (migration `18-skip-persistence.sql`)
Skipping a set/exercise in ActiveWorkout is optimistic in React state
(`handleSkipSet`/`handleSkipExercise`), but also upserts a `session_logs` row
with `weight`/`reps` null and `is_skipped=true` — a marker, not a logged set —
so `initSession`'s resume path (closing the app and reopening it, or just a
remount) can tell "skipped" apart from "never attempted" and restore it as
skipped instead of reverting to blank. Undoing a skip
(`handleUnskipSet`/`handleUnskipExercise`) deletes the marker row. Every stats
RPC already filters on `weight is not null`, so these rows are already inert
for XP/streak/PR purposes — a CHECK constraint (`weight is null and reps is
null` whenever `is_skipped`) enforces that instead of relying on the client
to always uphold it.

### Feedback (src/components/FeedbackModal.tsx, (app)/admin/feedback/)
Users reach the developer through a "Send Feedback" row in Profile → Settings,
which opens a modal (type chips, message, up to 3 images ≤5 MB, optional
"send anonymously"). Images upload to the private `feedback-images` bucket keyed
`{user_id}/{uuid}.{ext}` before the row is written; the row stores object paths,
never URLs, and the inbox mints short-lived signed URLs server-side.

Rate limit: **3 submissions per 10 minutes and 20 per day, per user**, enforced by
the `feedback_rate_limit` BEFORE INSERT trigger — not by RLS (a policy on
`feedback` that subqueries `feedback` would recurse) and not by the client. The
modal pre-checks the same counts before uploading so a blocked submission fails
fast and doesn't strand images in the bucket, and maps the trigger's tagged
exception to plain English. **If you change the limits, change them in both
places** (`09-feedback.sql` and the constants in `FeedbackModal.tsx`).

The inbox lives at `/admin/feedback` — an email-style two-pane client (list +
detail, stacked below 900px via `.inbox-layout`) with search, read/starred
filters, type filter, sorting, mark read/unread, star, delete, and mark-all-read.
Mutations are optimistic and revert with a toast on failure.

**Access is enforced in Postgres, not the UI.** `is_grind_admin()` (see
`09-feedback.sql`) checks `auth.users.email` against the admin address and backs
the RLS policies: everyone can insert their own feedback, only the admin can
select all rows, update, or delete. `src/lib/utils/admin.ts` mirrors the address
for routing only — it decides whether the Profile link renders and whether
`/admin/feedback` 404s, and grants nothing on its own. "Anonymous" is a display
choice: `user_id` is always recorded (abuse control) and the inbox has a
"reveal sender" affordance.

### Dates & timezones (important)
Streak/calendar logic is timezone-sensitive. Always derive a date key from local
components via `localDateKey()` in `src/lib/utils/formatting.ts` — never
`toISOString().split('T')[0]`, which shifts the calendar day off UTC and breaks
streaks for users not in UTC. Stored `YYYY-MM-DD` keys are parsed back at local
noon (`new Date(key + 'T12:00:00')`) before comparison. The profile "days active"
count is computed client-side (user's timezone) for the same reason.

### Units
All weights are stored canonically in **lbs** in Supabase. `UnitContext` (kg/lbs,
persisted in localStorage, defaults to imperial/lbs) is a display preference that
**converts** numbers at the display/input boundaries — it does not change stored
values. `useUnit()` exposes: `unitLabel` (label only), `toDisplay(canonicalLbs)`
(stored→display unit), `fromDisplay(displayValue)` (typed value→canonical lbs), and
`fmt(canonicalLbs)` (display string, 1-decimal, trailing zeros stripped). Convert
stored→display wherever a weight is shown (use `fmt`/`toDisplay`, never raw); convert
display→canonical with `fromDisplay` before saving, and prefill inputs via `fmt`. Keep
all comparisons (PR detection, "previous best", volume/e1RM) in canonical lbs.
`fromDisplay` never rounds — only display is rounded — so toggling a read-only value
drifts zero; one-time quantization can occur only when a kg value is edited and saved.
Conversion is instant because it's React Context. Never hardcode "lbs"/"kg".

## File Structure
src/
  app/
    layout.tsx                    — root layout, PWA meta, manifest, fonts
    page.tsx                      — redirects /home or /login
    icon.tsx / apple-icon.tsx     — generated G favicon / touch icon
    login/page.tsx
    setup/page.tsx                — username claim (first run)
    auth/callback/route.ts        — OAuth code exchange
    (app)/
      layout.tsx                  — wraps UnitProvider + TopNav (desktop) + BottomNav
                                     (mobile), safe-area padding. Resolves the unit
                                     preference server-side from the grind_unit_pref
                                     cookie to avoid a hydration flash.
      error.tsx                   — error boundary
      home/page.tsx + HomeDashboard.tsx + loading.tsx
      log/page.tsx + DaySelect.tsx + ActiveWorkout.tsx + CompletionModal.tsx
                  + WorkoutManager.tsx + past/page.tsx (log/edit/delete past)
      progress/page.tsx + ProgressChart.tsx + loading.tsx
      profile/page.tsx + ProfileDashboard.tsx + BodyWeightCard.tsx + loading.tsx
      leaderboard/page.tsx + LeaderboardClient.tsx + FriendsAccordion.tsx + ShareCard.tsx
      admin/feedback/page.tsx + FeedbackInbox.tsx — developer-only inbox (404s
                                     for everyone else; RLS is the real gate)
  components/
    BottomNav.tsx, TopNav.tsx, WorkoutCalendar.tsx, PlateCalculator.tsx, RestTimerBar.tsx
    FeedbackModal.tsx, ThemeToggle.tsx
    BadgeIcon.tsx (shared badge icon set) + BadgeUnlockOverlay.tsx (full-screen unlock celebration)
    ui/ (Button, Card, IconButton, Input, SectionLabel, StatTile, index)
  lib/
    supabase/client.ts + server.ts
    contexts/UnitContext.tsx + ThemeContext.tsx + MotionContext.tsx
    hooks/useRestTimer.ts + useExitingValue.ts
    types/index.ts
    utils/gamification.ts + formatting.ts + badges.ts + haptics.ts + sessions.ts + rotation.ts
         + admin.ts (admin-email check for routing/UI only)
    brand-icon.tsx
  proxy.ts                        — auth gate + redirect to /setup if no profile
                                    (Next 16 renamed the Middleware convention to Proxy)
docs/
  SQL.md + sql/*.sql              — ordered schema migrations
public/
  manifest.json, icon-192.png, icon-512.png
scripts/
  generate-icons.mjs
