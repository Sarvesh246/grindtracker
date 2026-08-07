-- Phase 23: "Skip tips" opt-out for ActiveWorkout's contextual tooltips.
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ----------------
-- The one-off feature tooltips in ActiveWorkout (aw-check, aw-warmup, aw-plate,
-- etc., see useFeatureTooltip) each show once ever, the first time their control
-- is genuinely used. With ~10 of them, a new user sees one drip in on most of
-- their first several workouts — which reads as "these keep showing up" even
-- though no single tooltip repeats. This column backs a "Skip tips" link on the
-- tooltip bubble (mirrors the scripted tours' "Skip tutorial") so a user can opt
-- out of the whole family at once, same shape as onboarding_skip_all but scoped
-- to tooltips only (see the module doc in OnboardingContext.tsx for why the two
-- opt-outs are kept independent).
--
-- Owner-writable through the same row-level policy that already covers the
-- other onboarding_* columns — no new RLS policy needed.

alter table user_profiles
  add column if not exists onboarding_tooltips_skipped boolean not null default false;
