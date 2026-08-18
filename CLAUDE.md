# GRIND — Gym Tracker

## Status: COMPLETE ✅
Core phases (1–7) plus later ships (flex days, photos, onboarding, web push,
weight targets, offline set queue, RPE, data export) — single-user PWA in daily use.
Schema migrations run through `docs/sql/52-*.sql`.

## Git Workflow
Single-user repo, no review process. Commit and push directly to `main` —
do not create feature branches or pull requests unless the user explicitly
asks for one.

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

### Motion system (globals.css)
Five shared primitives cover nearly every transition in the app. **Reach for
these before writing a bespoke animation** — being CSS-driven is what lets
Reduced motion above zero them out in one place, with no component tracking
animation state:

| Class | What it does | Used by |
| --- | --- | --- |
| `.press` / `.press-card` | tap dip (scale .96 / .985) + the usual colour transitions | pills, tabs, nav items, `ui/Button`, `ui/IconButton`, day & leaderboard cards |
| `.drawer` + `data-open` | height collapse via `grid-template-rows: 0fr→1fr` | badges, body-weight history, friends accordion, per-set notes |
| `.swap-in` | fade + 6px rise for a panel whose contents changed | progress chart, calendar month grid |
| `.stagger` (children set `--i`) | indexed list entrance | progress stats/recent sessions, leaderboard rows, day grid |
| `.stagger-auto` | same, nth-child delays, fade only | home dashboard columns |

Three rules that are easy to get wrong:
- **Check new utility names against Tailwind's.** This landed broken once: the
  drawer was originally `.collapse`, which is a Tailwind utility
  (`visibility: collapse`) — the panel animated to full height with its
  contents invisible.
- **Fill mode is `backwards`, never `both`.** An element holding a finished
  transform becomes a containing block for fixed/absolute descendants, which
  silently breaks the fixed workout bars and nav.
- **A `.drawer`'s direct child must have no padding.** `grid-template-rows: 0fr`
  zeroes only its *content* height, and `overflow: hidden` clips at the padding
  box — so padding on the grid item leaves a sliver of the collapsed panel
  showing (this shipped once as a row of pill-shaped bars under every set in
  ActiveWorkout). Pad an inner wrapper instead.
- **A `.drawer`'s inner wrapper clips.** Give the content 4px of top padding —
  not 2px — so keyboard focus rings aren't cut: the ring sits `outline-offset:
  2px` beyond the element plus its own 2px width, so it needs a full 4px of
  clearance from the clip edge, not just the offset (this shipped once as the
  top of a focused set-note input reading as cropped, permanently, not just
  mid-animation). Mark the content `inert` while closed so collapsed controls
  leave the tab order. Don't nest a `.stagger` inside a `.drawer` — the height
  slide is already the reveal, and layering a per-item fade on top just makes
  it feel slow.

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
- sessions — user_id, day_type, started_at, completed_at, xp_earned, note.
  Client DELETE is only for open sessions (`completed_at is null`, migration
  `40`); finished workouts go through `delete_session` so stats recompute.
- session_logs — session_id, exercise_id, set_number, weight, reps, is_pr,
  is_warmup, note, rpe (optional 1–10, migration `31`), is_skipped (default
  false). UNIQUE on (session_id, exercise_id, set_number). Client writes of
  `is_pr` are forced false by trigger; authoritative flags come from
  `grind_recompute_stats` on finish. `is_skipped` rows are markers
  (weight/reps always null, enforced by a CHECK) that let a skipped set in
  ActiveWorkout survive closing/resuming the app — see Skip persistence below
  and migration `18-skip-persistence.sql`.
- user_stats — xp_total, level, current_streak, longest_streak,
  last_workout_date, total_workouts
- user_badges — user_id, badge_id, earned_at
- body_weights — user_id, weight, recorded_at (date). UNIQUE (user_id, recorded_at).
  One row per calendar day; `BodyWeightCard` upserts on that pair. See Body
  weight editing below.
- user_profiles — id (= auth uid), username (unique), display_name, avatar_url
- friendships — requester_id, addressee_id, status ('pending' | 'accepted')
- user_day_categories — (user_id, day_key) → category ('push'|'pull'|'legs'|'other'),
  maps custom day names to leaderboard tabs.
- user_day_colors — (user_id, day_key) → color (`#rrggbb`). Optional override for
  Log day cards, the home calendar, and past-log pills. Missing row uses the
  derived palette (named push/pull/legs, or the rotating extra pool). Picked
  from WorkoutManager’s color screen. See migration `49-user-day-colors.sql`.
- user_rotation — user_id (PK), mode ('auto'|'manual'), sequence (jsonb array of
  day_keys, may repeat), current_index (pointer to last completed slot). Drives the
  home page's suggested next day. See Rotation below.
- feedback — user_id, username/email (identity snapshot at submit time),
  category ('bug'|'feature'|'improvement'|'other'), message, image_paths (text[]
  of objects in the private `feedback-images` bucket), is_anonymous, is_read,
  is_starred. See Feedback below and migration `09-feedback.sql`.
- user_rest_days — (user_id, day_of_week, effective_from) PK, recurring weekly
  rest days (0=Sun..6=Sat, matches `extract(dow)`/`Date.getDay()`), configured in
  Profile. `effective_from` (migration `39`) is the first date that weekday
  counts; new rows start the next occurrence strictly after today so Settings
  cannot cover a missed workout the same day. `effective_until` (migration `43`,
  exclusive, null = active) soft-ends a weekday when removed so past coverage
  survives schedule changes; re-enable inserts a new open-ended interval.
  user_rest_dates — (user_id, rest_date) PK, one-off rest dates (Home "Rest today",
  or the missed-day banner). user_rest_cancels — (user_id, rest_date) PK, a
  scheduled rest date given up this week because a one-off used the weekly budget
  (`stolen_for`). See Rest days below and migrations `14-rest-days.sql`,
  `39-rest-day-skip.sql`, `43-rest-weekday-history.sql`.
RLS on exercises, sessions, session_logs, user_stats, user_badges, body_weights,
user_day_categories, user_day_colors, user_rotation, feedback, user_rest_days, user_rest_dates,
user_rest_cancels
(and delete policies on sessions/session_logs for discard).
`get_leaderboard(p_day_type, p_user_ids)` RPC ranks overall by XP, or
push/pull/legs by heaviest working-set lift (category-aware, security definer).
`get_friend_profile(p_user_id)` RPC (security definer, same self-or-accepted-
friend gate as `get_leaderboard`) backs the read-only friend profile view —
see Friend profiles below and migration `19-friend-profile.sql`.

Schema migrations live in `docs/sql/` (idempotent; apply in order via the
Supabase SQL editor). See `docs/SQL.md`.

## Gamification (src/lib/utils/gamification.ts)
XP: +100 per completed workout (needs ≥1 non-warmup working set — migration
`40`; warm-up-only sessions cannot finish), +25 per PR set, +50 when the new
streak hits a multiple of 7. Warm-up sets never count toward PRs.
Level: triangular curve — XP to advance from level n to n+1 is `500 * n`, so
cumulative XP for level n is `500 * n * (n-1) / 2`. `getLevel(xp)` inverts this.
Streak: continues on consecutive calendar days (gap of exactly 1 day
increments; same day keeps it), OR across a gap where every day in between is
a configured rest day (recurring or one-off confirmed — see Rest days below);
any other gap resets to 1. Home page zeroes a stale streak when the gap since
the last workout isn't fully covered by rest days.
PR: weight × reps (volume) > max non-warm-up volume in any previous completed
session for that exercise (migration `15-volume-based-prs.sql`). The first
completed session for an exercise is the baseline, not a PR (migration `51`).

## Badges (src/lib/utils/badges.ts)
35 badges — streak/workout-count/PR-count/level tiers, plus lifetime volume
(100K/500K/1M Club), plate milestones (Two/Three/Four Plates — a single set's
heaviest weight), time-of-day (early bird/night owl), weekend warrior, a
comeback badge (14+ day gap since the prior workout), flawless (a session with
zero skipped sets), rest-day/friend/body-weight-log config badges, and a
`completionist` meta-badge for earning every other one. `checkAndAwardBadges()`
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
| `complete_session(session_id, local_date, note, start_hour)` | `ActiveWorkout.handleFinish` |
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

### Failed reads vs. empty accounts
A dropped Supabase read returns `{ data: null }`, and dashboard reads are
destructured as `{ data }` with the error discarded — so one transient failure
among the home page's dozen parallel reads rendered an established user the
FIRST-RUN dashboard: welcome hero, level 0, streak 0, "log your first session".
Reopening the app "fixed" it, which is exactly what made it read as data loss.
Two rules keep it from coming back:

- Reads that decide *"is this a returning user"* go through `readWithRetry`
  (`src/lib/supabase/readWithRetry.ts`) — one retry, then `reportError`, never a
  silent empty result.
- **A missing `user_stats` row is a failed read, never a new user.** Every
  account is seeded one at signup (`grind_seed_user_stats`, migration `11`) and
  the client has no insert/delete on it, so `stats == null` can only mean the
  read failed. `home/page.tsx` passes `statsUnavailable`; `HomeDashboard` shows a
  "couldn't load your stats" card with a retry instead of zeros, and every
  first-run branch (hero, streak card, primary CTA, tour steps, overdue nudge) is
  gated on `isNewUser` = `!statsUnavailable && totalWorkouts === 0` — never on
  `totalWorkouts === 0` alone. `restDataUnavailable` is the same idea for the
  rest-day reads: without those rows every gap looks uncovered, and the client
  would zero a streak the user never broke.

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
completion (backdated `log/past` entries deliberately don't). New rotations seed
`current_index: -1` so the first day is next (`nextDay(seq, 0)` would skip it).
The suggestion is
non-binding — DaySelect still lets you pick any day, and marks the suggested one "UP NEXT".
Helpers are pure (no Supabase import). Apply migration `06-user-rotation.sql` first
(default `-1` as of `40`).

### Rest days (src/lib/utils/restDays.ts, migrations `14` + `39` + `43`)
Two ways to declare a day off without breaking the streak: recurring weekly
rest days (toggled as day-pills in Profile → Settings, backed by
`user_rest_days`) and one-off rest dates (`user_rest_dates`). Settings pills
are the **weekly budget N** and the default schedule — they do **not** cover
today when newly turned on (`effective_from` is the next occurrence of that
weekday strictly after local today), which closes the old bypass of toggling
today's weekday in Settings to save a streak. Existing rows stay at
`effective_from = 1970-01-01`. Removing a weekday soft-ends it
(`effective_until` = local today, exclusive) instead of deleting — past
occurrences keep counting for streaks; re-adding inserts a new open-ended
interval from the next occurrence (migration `43`).

Home has a **Rest today** control under the streak card: tap to insert a
one-off for today, tap again to undo. Scheduled rest (a Settings weekday
that's already in effect) is shown but not undone from Home. The button hides
when N=0 (configure rest days first) or when they already trained today
(unless there's a one-off to undo).

A Sun–Sat week cannot have more rest days than N. An extra one-off steals a
**later** scheduled rest day that week via `user_rest_cancels` (`stolen_for`
= the one-off); undoing the one-off deletes those cancels. If nothing is left
to steal, Postgres raises `REST_BUDGET_EXCEEDED`. Example: Saturday is the
configured rest day; Rest today on Wednesday cancels this week's Saturday.
Sunday is the first day of the week (migration `48`), so a Sunday rest day
has already spent its slot by Monday.

The missed-day banner still offers to confirm a small gap as rest, but only
when the gap fits **remaining** weekly slots (`uncovered.length <= N - used`).
Once N rest days are used this week — configured weekdays or Rest today skips
— another miss breaks the streak. Server-side, `grind_dates_connected(user,
from, to)` tests whether every day strictly between two dates is a rest day
(`grind_is_rest_day`, which honors one-offs, cancels, `effective_from`, and
`effective_until`); `grind_recompute_stats()` uses it to group workout dates
into rest-day-aware "runs". `restDays.ts` mirrors the same logic in TS
(`Date.getDay()` matches `extract(dow)`, 0=Sun..6=Sat) so the client can
compute gaps and Rest today eligibility using the viewer's own local "today"
— never the server's, per Dates & timezones below. Mutate through
`toggle_rest_today` / `set_rest_weekday`; do not UPDATE
`user_rest_days.effective_from` / `effective_until` from the client. Direct
INSERT/UPDATE/DELETE on `user_rest_days` is revoked (UTC-today hole + history
wipe); `user_rest_cancels` is insert/select only so a steal row cannot be
deleted while keeping the one-off. Weekly budget N counts only active
weekdays (`effective_until` is null) whose `effective_from` is on or before
this week's Saturday.

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

### Friend profiles ((app)/leaderboard/[username]/, migration `19-friend-profile.sql`)
Tapping a leaderboard row opens a read-only profile at `/leaderboard/[username]`
— banner (avatar, display name, level, XP bar), streak cards, lifetime stat
cards, and a collapsible badge grid. Own row goes to the real editable
`/profile` instead — no second read-only view of yourself. `page.tsx` resolves
the username to a user id via `user_profiles` (public-readable to any
authenticated user, `12-friendship-authz.sql`) then calls
`get_friend_profile(id)`; `FriendProfileView.tsx` is presentational only,
styled to match `ProfileDashboard.tsx`'s banner/streak/stat-card JSX exactly
(same inline styles, same `.stat-grid-4`/`.badge-grid` classes) so the two
feel like one page. If the RPC rejects (not a friend, or a hand-typed
username) the page renders a plain "profile unavailable" state rather than a
hard 404 — RLS/the RPC is the actual gate either way.

Both `FriendProfileView.tsx` and `ProfileDashboard.tsx` end with the same
footer: a centered "GRINDing since \<month year\>" line, "GRINDing" in
`--accent-text` (matching the "never `--accent` for text" rule under
Theming) — echoing the app name rather than a plain "Grinding". The join date
is `user_profiles.created_at`; `ProfileDashboard`'s own copy comes from
`profile/page.tsx`'s `joinedAt` prop (added alongside `username` in the same
query), the friend view's from `get_friend_profile`'s `joined_at` field. Keep
the two footers' copy/casing in sync if you change one.

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

### Body weight editing (src/app/(app)/profile/BodyWeightCard.tsx)
The card shows the last 90 days. The text field at the top only ever logs
TODAY; every past entry is corrected by **tapping its dot on the chart**
(each dot carries a transparent r=14 hit circle so the target clears 44px,
and the selected one gets an accent halo), which opens a bottom-sheet
`Dialog` with the date, a prefilled input, SAVE, and a destructive "Delete
this entry" that swaps the sheet into a DELETE/KEEP confirm rather than
stacking a second modal.

The full list is a **collapsed** "History" disclosure below the chart — it
used to render every reading inline, which after months of daily logging
buried the rest of the profile. Expanded, it's a scrolling (`max-height:
240px`) list of full-width buttons opening the same sheet, and it doubles as
the keyboard/screen-reader equivalent of the `aria-hidden` chart, so keep it
in the DOM and keep every entry reachable from it.

Deletes are a plain `body_weights` DELETE — the table's single `for all`
policy (`03-body-weights.sql`) already covers it, no migration needed. The
sheet's slide-up is the CSS `sheet-up` keyframe in `globals.css`, not
state-driven, so `html.reduce-motion` neutralizes it for free (unlike the
Recharts line, which still needs the explicit `isAnimationActive` opt-out
described under Reduced motion).

### Dates & timezones (important)
Streak/calendar logic is timezone-sensitive. Always derive a date key from local
components via `localDateKey()` in `src/lib/utils/formatting.ts` — never
`toISOString().split('T')[0]`, which shifts the calendar day off UTC and breaks
streaks for users not in UTC. Stored `YYYY-MM-DD` keys are parsed back at local
noon (`new Date(key + 'T12:00:00')`) before comparison. The profile "days active"
count is computed client-side (user's timezone) for the same reason.

A date the *viewer* should read (not a stored key) must not be produced during
SSR: both `/home` and `/progress` render server-side first, so calling
`formatHeaderDate()` in their JSX printed Vercel's UTC day and then mismatched
on hydration. Render it through `<TodayLabel />`
(`src/components/TodayLabel.tsx`), whose `useSyncExternalStore` server snapshot
is null and which re-reads on focus so an app left open past midnight rolls over.

### Day keys
A day key (`exercises.day_type`, `user_day_categories.day_key`, rotation
`sequence` entries) doubles as the `?day=` query param `/log` reads, so it has
to be URL-safe. Build new ones with `slugDayKey()` in
`src/lib/utils/dayKeys.ts` — lowercase, everything outside `[a-z0-9]` collapsed
to a single hyphen — and navigate with `logDayHref()` from the same module,
never a bare `` `/log?day=${key}` ``. Both halves matter: the slug keeps new
keys clean, and the percent-encoding rescues keys that already exist (a day
named "Arms & Abs" used to slug to `arms-&-abs` and open a workout for
`arms-`, and the Coach's `create_day` still allows spaces and underscores).

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
                  + [username]/page.tsx + FriendProfileView.tsx (read-only friend profile)
    admin/feedback/page.tsx + FeedbackInbox.tsx — developer-only inbox (404s
      for everyone else; RLS is the real gate)
    admin/lab/ — developer-only UP NEXT card-style playground (email gate only)
  components/
    BottomNav.tsx, TopNav.tsx, WorkoutCalendar.tsx, PlateCalculator.tsx, RestTimerBar.tsx
    FeedbackModal.tsx, ThemeToggle.tsx
    BadgeIcon.tsx (shared badge icon set) + BadgeUnlockOverlay.tsx (full-screen unlock celebration)
    DayCardPreview.tsx + DayColorPicker.tsx — Log day-card preview + color picker (WorkoutManager)
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
