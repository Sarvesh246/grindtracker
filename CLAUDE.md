# GRIND — Gym Tracker

## Stack
Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (@supabase/ssr), Recharts. Single user PWA. Deploy target: Vercel.

## Completed Phases
- Phase 1: Project setup, Supabase auth, Google login ✅
- Phase 2: App shell with bottom nav + Home dashboard ✅
- Phase 3: Workout logger — session management, set logging, PR detection, XP, streaks, badges, completion modal ✅

## Current State
Core loop is fully working. User can start a Push/Pull/Legs workout, log sets with weight 
and reps, check off each set, see PRs detected in real time, finish the workout, earn XP,
have their streak updated, earn badges, and see the completion modal. Home screen reflects
all updated stats after returning from a completed workout.
/progress and /profile are still placeholder pages.

## Design System
Background: #0f0f0f | Surface: #1a1a1a | Surface elevated: #242424
Border: #2e2e2e | Accent: #c8f135 | Accent dim: #8faa24
Text primary: #f0f0f0 | Text secondary: #888888 | Text muted: #555555
Danger: #ef4444

Fonts: Bebas Neue (display/headings), DM Sans (body/UI), JetBrains Mono (numbers/weights)
Border radius: 12px standard, 8px small, 9999px pill
Transitions: 150ms ease
Primary button: bg #c8f135, text #0f0f0f, font bold (dark text on bright bg)
Secondary button: bg #242424, text #f0f0f0, border #2e2e2e

## Supabase Tables
- exercises — pre-seeded, 17 exercises, no RLS
- sessions — user_id, day_type, started_at, completed_at, xp_earned
- session_logs — session_id, exercise_id, set_number, weight, reps, is_pr
  UNIQUE constraint on (session_id, exercise_id, set_number) — required for upsert
- user_stats — user_id, xp_total, level, current_streak, longest_streak, last_workout_date, total_workouts
- user_badges — user_id, badge_id, earned_at
RLS enabled on sessions, session_logs, user_stats, user_badges.

## Gamification
XP: +100 completed workout, +25 per PR set, +50 per 7-day streak milestone
Level: Math.floor(xp_total / 500) + 1
Streak: resets if gap > 2 days between workouts. If same day, streak unchanged.
PR: weight > max weight in any previous completed session for that exercise.
    After a PR is logged, previousBests updates live so subsequent sets in same session compare against the new best.
11 badges defined in src/lib/utils/badges.ts

## File Structure
src/
  app/
    layout.tsx
    page.tsx
    login/page.tsx
    auth/callback/route.ts
    (app)/
      layout.tsx                  — shell with BottomNav
      home/
        page.tsx                  — server component, fetches dashboard data
        HomeDashboard.tsx         — client component
        loading.tsx
      log/
        page.tsx                  — Suspense wrapper, routes to DaySelect or ActiveWorkout
        DaySelect.tsx             — push/pull/legs selection cards
        ActiveWorkout.tsx         — session screen with ExerciseCard + SetRow components
        CompletionModal.tsx       — slide-up modal after finishing
      progress/page.tsx           — placeholder
      profile/page.tsx            — placeholder
  components/
    BottomNav.tsx
  lib/
    supabase/client.ts + server.ts
    types/index.ts
    utils/
      gamification.ts
      formatting.ts
      badges.ts                   — ALL_BADGES, checkAndAwardBadges()
  middleware.ts

## Next Phase
Phase 4: Progress charts. Exercise selector (all 17 exercises grouped by push/pull/legs),
line chart showing weight over time per exercise (Recharts), PR markers on chart,
stats bar (best/sessions/last/PRs), recent sessions list.
