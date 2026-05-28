# GRIND — Gym Tracker

## Stack
Next.js 14 App Router, TypeScript, Tailwind CSS, Supabase (@supabase/ssr), Recharts. Single user PWA. Deploy target: Vercel.

## Completed Phases
- Phase 1: Project setup, Supabase auth, Google login ✅
- Phase 2: App shell with bottom nav + Home dashboard ✅

## Current State
Auth works. Bottom nav works across all 4 tabs. Home dashboard fetches and displays
user stats, streak, level/XP bar, last workout summary, and the Start Workout CTA.
/log, /progress, /profile are placeholder pages — not yet built.

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
- user_stats — user_id, xp_total, level, current_streak, longest_streak, last_workout_date, total_workouts
- user_badges — user_id, badge_id, earned_at
RLS enabled on sessions, session_logs, user_stats, user_badges.

## Gamification
XP: +100 completed workout, +25 per PR set, +50 per 7-day streak milestone
Level: Math.floor(xp_total / 500) + 1
Streak: resets if gap > 2 days between workouts
PR: weight > max weight in any previous completed session for that exercise

## File Structure
src/
  app/
    layout.tsx                    — root layout, viewport meta tags
    page.tsx                      — redirects to /home or /login
    login/page.tsx                — Google OAuth login
    auth/callback/route.ts        — OAuth exchange
    (app)/
      layout.tsx                  — shell with BottomNav
      home/
        page.tsx                  — server component, fetches all dashboard data
        HomeDashboard.tsx         — client component, renders dashboard UI
        loading.tsx               — shimmer skeleton
      log/page.tsx                — placeholder
      progress/page.tsx           — placeholder
      profile/page.tsx            — placeholder
  components/
    BottomNav.tsx                 — fixed bottom nav, 4 tabs
  lib/
    supabase/
      client.ts                   — browser Supabase client
      server.ts                   — server Supabase client
    types/index.ts                — Exercise, Session, SessionLog, UserStats, UserBadge
    utils/
      gamification.ts             — getLevel, getXpInCurrentLevel, getNextDayType
      formatting.ts               — formatHeaderDate, formatShortDate, formatDayType
  middleware.ts                   — auth guard, redirects to /login if no session

## Next Phase
Phase 3: Workout logger. Day select screen → active session screen with set logging,
weight/reps inputs, real-time Supabase writes, PR detection, XP calculation,
streak update, badge checking, and completion modal.
