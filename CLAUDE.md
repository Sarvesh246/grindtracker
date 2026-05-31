# GRIND — Gym Tracker

## Status: COMPLETE ✅
All core phases (1–7) built and deployed. Single-user PWA, in daily use.

## Stack
Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4,
Supabase (@supabase/ssr), Recharts, deployed on Vercel.

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

## Supabase Tables
- exercises — name, day_type, sets_target, reps_target, sort_order. Seeded
  push/pull/legs; users add/edit/delete their own days & exercises. No RLS.
- sessions — user_id, day_type, started_at, completed_at, xp_earned, note
- session_logs — session_id, exercise_id, set_number, weight, reps, is_pr,
  is_warmup, note. UNIQUE on (session_id, exercise_id, set_number).
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
RLS on sessions, session_logs, user_stats, user_badges, body_weights,
user_day_categories, user_rotation (and delete policies on sessions/session_logs for discard).
`get_leaderboard(p_day_type, p_user_ids)` RPC ranks overall by XP, or
push/pull/legs by heaviest working-set lift (category-aware, security definer).

Schema migrations live in `docs/sql/` (idempotent; apply in order via the
Supabase SQL editor). See `docs/SQL.md`.

## Gamification (src/lib/utils/gamification.ts)
XP: +100 per completed workout, +25 per PR set, +50 when the new streak hits a
multiple of 7. Warm-up sets never count toward PRs.
Level: triangular curve — XP to advance from level n to n+1 is `500 * n`, so
cumulative XP for level n is `500 * n * (n-1) / 2`. `getLevel(xp)` inverts this.
Streak: continues only on consecutive calendar days (gap of exactly 1 day
increments; same day keeps it; any larger gap resets to 1). Home page zeroes a
stale streak when the last workout was more than 1 day ago.
PR: weight > max non-warm-up weight in any previous completed session for that exercise.
14 badges in src/lib/utils/badges.ts.

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
      layout.tsx                  — wraps UnitProvider + BottomNav, safe-area padding
      error.tsx                   — error boundary
      home/page.tsx + HomeDashboard.tsx + loading.tsx
      log/page.tsx + DaySelect.tsx + ActiveWorkout.tsx + CompletionModal.tsx
                  + WorkoutManager.tsx + past/page.tsx (log/edit/delete past)
      progress/page.tsx + ProgressChart.tsx + loading.tsx
      profile/page.tsx + ProfileDashboard.tsx + BodyWeightCard.tsx + loading.tsx
      leaderboard/page.tsx + LeaderboardClient.tsx + FriendsAccordion.tsx + ShareCard.tsx
  components/
    BottomNav.tsx, WorkoutCalendar.tsx, PlateCalculator.tsx, RestTimerBar.tsx
    ui/ (Button, Card, IconButton, Input, SectionLabel, StatTile, index)
  lib/
    supabase/client.ts + server.ts
    contexts/UnitContext.tsx
    hooks/useRestTimer.ts
    types/index.ts
    utils/gamification.ts + formatting.ts + badges.ts + haptics.ts + sessions.ts + rotation.ts
    brand-icon.tsx
  middleware.ts                   — auth gate + redirect to /setup if no profile
docs/
  SQL.md + sql/*.sql              — ordered schema migrations
public/
  manifest.json, icon-192.png, icon-512.png
scripts/
  generate-icons.mjs
