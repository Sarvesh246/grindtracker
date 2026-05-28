# GRIND — Gym Tracker

## Stack
Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (@supabase/ssr), Recharts. Single user PWA. Deploy target: Vercel.

## Completed Phases
- Phase 1: Project setup, Supabase auth, Google login ✅
- Phase 2: App shell with bottom nav + Home dashboard ✅
- Phase 3: Workout logger — session management, set logging, PR detection, XP, streaks, badges, completion modal ✅
- Phase 4: Progress charts — exercise selector, line chart, PR markers, stats bar, recent sessions ✅

## Current State
Four of five screens are fully built and working. The full core loop works end to end:
log workout → earn XP → see progress on charts → home dashboard updates.
/profile is the only placeholder remaining.

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
  UNIQUE constraint on (session_id, exercise_id, set_number)
- user_stats — user_id, xp_total, level, current_streak, longest_streak, last_workout_date, total_workouts
- user_badges — user_id, badge_id, earned_at
RLS enabled on sessions, session_logs, user_stats, user_badges.

## Gamification
XP: +100 completed workout, +25 per PR set, +50 per 7-day streak milestone
Level: Math.floor(xp_total / 500) + 1
Streak: resets if gap > 2 days. Same day workout does not increment streak.
PR: weight > max weight in any previous completed session for that exercise.
11 badges defined in src/lib/utils/badges.ts

## File Structure
src/
  app/
    layout.tsx
    page.tsx
    login/page.tsx
    auth/callback/route.ts
    (app)/
      layout.tsx
      home/
        page.tsx + HomeDashboard.tsx + loading.tsx
      log/
        page.tsx                  — Suspense wrapper
        DaySelect.tsx
        ActiveWorkout.tsx         — ExerciseCard + SetRow inline components
        CompletionModal.tsx
      progress/
        page.tsx                  — client component, all data fetching inline
        ProgressChart.tsx         — Recharts line chart with custom dot + tooltip
        loading.tsx
      profile/page.tsx            — placeholder
  components/
    BottomNav.tsx
  lib/
    supabase/client.ts + server.ts
    types/index.ts
    utils/
      gamification.ts
      formatting.ts
      badges.ts
  middleware.ts

## Next Phase
Phase 5: Profile screen. Google avatar + display name, XP progress bar, streak stats,
lifetime stats grid (workouts/PRs/sets/days active), full badge grid (11 badges,
earned vs locked states), sign out button.
