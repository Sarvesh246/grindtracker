-- Phase 17: per-day exercise disable toggle.
-- Apply via Supabase SQL editor.
-- Idempotent: safe to re-run.
--
-- Lets a user turn an exercise off for a day (e.g. "no more pull-ups on pull
-- day") without deleting it and losing its logged history / PR bar. Disabled
-- exercises are skipped when a new live workout is built and when logging a
-- past workout, but stay visible (and re-enableable) in Manage Workouts.
--
-- No RLS change needed — the existing "own exercises" FOR ALL policy
-- (07-exercises-per-user.sql) already covers UPDATE of this column.

alter table exercises
  add column if not exists active boolean not null default true;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('17-exercise-active-flag') on conflict (version) do nothing;
