# GRIND — Gym Tracker

## Status: COMPLETE ✅
All 6 phases built and deployed.

## Stack
Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (@supabase/ssr),
Recharts, deployed on Vercel. Single user PWA.

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

## Supabase Tables
- exercises — 17 pre-seeded, no RLS
- sessions — user_id, day_type, started_at, completed_at, xp_earned
- session_logs — session_id, exercise_id, set_number, weight, reps, is_pr
  UNIQUE constraint on (session_id, exercise_id, set_number)
- user_stats — xp_total, level, current_streak, longest_streak, last_workout_date, total_workouts
- user_badges — user_id, badge_id, earned_at
RLS on sessions, session_logs, user_stats, user_badges.

## Gamification
XP: +100 workout, +25 per PR set, +50 per 7-day streak milestone
Level: Math.floor(xp_total / 500) + 1
Streak: resets if gap > 2 days. Same-day workout does not increment.
PR: weight > max weight in any previous completed session for that exercise.
11 badges in src/lib/utils/badges.ts

## File Structure
src/
  app/
    layout.tsx                    — root layout, PWA meta, manifest link
    page.tsx                      — redirects /home or /login
    login/page.tsx
    auth/callback/route.ts
    (app)/
      layout.tsx                  — paddingBottom accounts for nav + safe area
      error.tsx                   — error boundary
      home/page.tsx + HomeDashboard.tsx + loading.tsx
      log/page.tsx + DaySelect.tsx + ActiveWorkout.tsx + CompletionModal.tsx
      progress/page.tsx + ProgressChart.tsx + loading.tsx
      profile/page.tsx + ProfileDashboard.tsx + loading.tsx
  components/
    BottomNav.tsx                 — safe area padding on nav
  lib/
    supabase/client.ts + server.ts
    types/index.ts
    utils/gamification.ts + formatting.ts + badges.ts
  middleware.ts
public/
  manifest.json
  icon-192.png
  icon-512.png
scripts/
  generate-icons.mjs
