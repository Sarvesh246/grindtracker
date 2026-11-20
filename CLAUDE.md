# GRIND — Gym Tracker

## Status
Live and in daily use: workout logging, streaks/XP/badges, rest days, flex days,
progress photos, onboarding, web push, offline set queue, Coach, friends and
leaderboard, and a token-authenticated API for a Garmin watch app (`/api/watch/v1`).
Schema migrations run through `docs/sql/73-*.sql`.

One developer, but a **multi-user app**: friends, a leaderboard and public
usernames mean RLS and per-caller authorization are required everywhere.
[docs/MONETIZATION.md](docs/MONETIZATION.md) is a proposal for a paid tier —
nothing in it is built.

## Git Workflow
Single-developer repo, no review process. Commit and push directly to `main` —
do not create feature branches or pull requests unless the user explicitly
asks for one. Commit messages explain *why*, not what the diff already shows.

## Stack
Next.js 16 App Router, React 19, TypeScript, Tailwind CSS v4,
Supabase (@supabase/ssr), Recharts, deployed on Vercel.

> ⚠️ Next.js 16 has breaking changes vs. earlier versions (APIs, conventions,
> file structure). It may differ from training data — consult
> `node_modules/next/dist/docs/` before writing Next-specific code (see `AGENTS.md`).

Commands: `npm run dev`, `npm run build`, `npm start`, `npm run lint`,
`npm run typecheck`, `npm test` (unit), `npm run test:e2e` (Playwright),
`npm run test:sql-parity` (needs a Postgres, see Parity below),
`npm run migrations:check` (needs a service-role key), `npm run coach:eval`.

`npm run build` uses Turbopack, which needs native SWC bindings. Without them
(musl/WASM-only sandboxes) use `npx next build --webpack`. The build prerenders
client pages, so `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
must be set (Vercel sets them; locally export placeholders).

CI (`.github/workflows/ci.yml`): typecheck, unit tests, lint, audit, build, plus
separate `sql-parity` and `e2e` jobs. See [docs/CI.md](docs/CI.md).

## Where the detail lives
Read the matching doc **before** changing that area; these were split out of this
file and are authoritative.

| Touching… | Read |
| --- | --- |
| Colors, fonts, theming, reduced motion, shared motion classes, nav | [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md) |
| Tables, RLS, columns | [docs/SCHEMA.md](docs/SCHEMA.md) |
| XP, levels, streaks, PRs, badges, stats RPCs, failed-read handling | [docs/GAMIFICATION.md](docs/GAMIFICATION.md) |
| Authorization, `security definer`, headers, proxy | [docs/SECURITY.md](docs/SECURITY.md) |
| Rotation / "up next", rest days, disabled days, weekly plans, skip markers | [docs/WORKOUT-LOGIC.md](docs/WORKOUT-LOGIC.md) |
| Offline sync, service worker, rename vs swap | [docs/WORKOUT-UI.md](docs/WORKOUT-UI.md) |
| Friend profiles, feedback inbox, body weight | [docs/SOCIAL-AND-PROFILE.md](docs/SOCIAL-AND-PROFILE.md) |
| Coach (Gemini), rate limits, eval | [docs/COACH.md](docs/COACH.md) |
| Energy schedule (peaks/dips), circadian model, energy alerts | [docs/ENERGY.md](docs/ENERGY.md) |
| Web push | [docs/PUSH.md](docs/PUSH.md) |
| Garmin watch API, device tokens | [docs/watch-api.md](docs/watch-api.md) |
| Migrations | [docs/SQL.md](docs/SQL.md) |
| CI, e2e, parity tests | [docs/CI.md](docs/CI.md) |
| Scrolling on mobile | [docs/MOBILE-SCROLLING.md](docs/MOBILE-SCROLLING.md) |

## Rules that are easy to break
- **Design tokens:** background `#0f0f0f`, surface `#1a1a1a`, accent `#c8f135`.
  Fonts: Bebas Neue (display), DM Sans (body), JetBrains Mono (numbers). Nothing
  below 10px (10px only for uppercase labels with letter-spacing). The lime
  `--accent` is a **fill**; for lime *text* use `--accent-text`. Reach for the
  shared motion classes (`.press`, `.drawer`, `.swap-in`, `.stagger`) before
  writing a bespoke animation, and honor Reduce Motion — details in DESIGN-SYSTEM.
- **Stats are server-authoritative.** XP, level, streaks and `is_pr` are derived
  in Postgres by `grind_recompute_stats()`. The client has **no UPDATE on
  `user_stats`** — never reintroduce a direct write; go through the RPCs:

  | RPC | Called from |
  | --- | --- |
  | `complete_session(session_id, local_date, note, start_hour)` | `ActiveWorkout.handleFinish` |
  | `uncomplete_session(session_id, local_date)` | `ActiveWorkout.handleUndoFinish`, `FinishUndoBanner` |
  | `delete_session(session_id, local_date)` | `log/past` delete |
  | `refresh_stats(local_date)` | `log/past` save, `HomeDashboard` stale-streak lapse |
  | `toggle_rest_today(local_date)` | `HomeDashboard` Rest today / undo |
  | `set_rest_weekday(day_of_week, enabled, local_date)` | Settings + onboarding rest-day pills |

- **RLS is the boundary, never the UI.** Every `security definer` function must
  authorize its own caller and pin `search_path`. Never trust a client number
  that feeds a leaderboard.
- **Parity:** the level curve (`grind_level_for_xp` ↔ `getLevel`), the Sunday week
  start (`grind_week_start` ↔ `weekStart`) and rest-day connectivity/budget
  (`grind_dates_connected`, `grind_rest_budget` ↔ `restDays.ts`) exist in both SQL
  and TS. Change one, change both — `npm run test:sql-parity` compares them
  against the real function text in `docs/sql/` and runs in CI.
- **Migrations:** `docs/sql/` is the only source of truth, applied by hand in the
  Supabase SQL editor and idempotent. Every file ends with an insert into
  `grind_migrations` (created by `00-migration-tracking.sql`); copy that line into
  any new migration, add its row to `docs/SQL.md`, and run
  `npm run migrations:check` against production after pasting. Apply the SQL
  *before* deploying code that calls new RPCs. Next free number: `74`.
- **Rotation pointer:** every write goes through `rotationStore.ts`, never a bare
  `user_rotation` upsert (WORKOUT-LOGIC).
- **Offline sync is deliberately gentle:** no polling, no per-set requests
  (WORKOUT-UI).
- **Coach:** run `npm run coach:eval` before changing its prompt, router, tools or
  model settings (COACH).
- **Failed reads are not empty accounts.** A null `user_stats` read means the read
  failed, not a new user (GAMIFICATION).
- **Weights** are stored in lbs; convert only at display/input boundaries (Units).
- **Dates** come from `localDateKey()`, never `toISOString().split('T')[0]` (Dates).

## Cross-cutting conventions

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
    watch/ (handlers, schema, today, token, deps) — Garmin watch API; routes in app/api/watch/v1/
  proxy.ts                        — auth gate + redirect to /setup if no profile
                                    (Next 16 renamed the Middleware convention to Proxy)
docs/
  SQL.md + sql/*.sql              — ordered schema migrations
public/
  manifest.json, icon-192.png, icon-512.png
scripts/
  generate-icons.mjs
