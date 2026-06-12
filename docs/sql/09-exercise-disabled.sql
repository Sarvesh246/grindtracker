-- Phase 9: per-exercise disabled flag.
-- Idempotent: safe to re-run.
--
-- When disabled = true the exercise is excluded from the active workout UI.
-- The user can toggle this from Workout Manager instead of having to manually
-- skip the exercise every session.

alter table exercises add column if not exists disabled boolean not null default false;
