-- Phase 2 schema: warm-up tagging and notes.
-- Apply via Supabase SQL editor.
-- Idempotent: safe to re-run.

alter table session_logs
  add column if not exists is_warmup boolean not null default false;

alter table session_logs
  add column if not exists note text;

alter table sessions
  add column if not exists note text;

-- Useful index for previous-best queries that filter out warm-ups.
create index if not exists session_logs_exercise_completed_working_idx
  on session_logs (exercise_id, is_warmup)
  where is_warmup = false;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('02-warmup-and-notes') on conflict (version) do nothing;
