-- Phase 7: make the exercise/day catalog per-user.
-- Idempotent: safe to re-run.
--
-- Until now `exercises` had no owner and no RLS, so every account shared ONE
-- global catalog: a second user would see (and could edit/delete) the first
-- user's days & exercises. This migration gives each row an owner, backfills the
-- existing rows to the original user, and locks reads/writes to the owner via RLS
-- so each user's tracker is fully private. Logged data (sessions, session_logs,
-- user_stats, body_weights, …) was already per-user and is unaffected.
--
-- Run this in the Supabase SQL editor after 06-user-rotation.sql.

-- ── 1. Owner column ─────────────────────────────────────────────────────────
-- Added nullable first so the backfill can populate it before NOT NULL is set.
-- ON DELETE CASCADE: removing a user cleans up their exercises (session_logs that
-- reference those exercises are already removed via the sessions→user cascade).
alter table exercises
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- ── 2. Backfill existing rows ───────────────────────────────────────────────
-- All pre-existing exercises belong to the original (single) user. Assign them to
-- whoever owns the most completed/started sessions (the real trainer); fall back
-- to the oldest auth account if there are no sessions yet. Only touches NULLs, so
-- re-running never reassigns already-owned rows.
--
-- If you somehow have multiple accounts already and the wrong owner is chosen,
-- replace the coalesce(...) below with your literal uid:
--   update exercises set user_id = '<your-auth-uid>' where user_id is null;
update exercises
set user_id = coalesce(
  (select user_id from sessions group by user_id order by count(*) desc limit 1),
  (select id from auth.users order by created_at asc limit 1)
)
where user_id is null;

-- ── 3. Enforce ownership ────────────────────────────────────────────────────
alter table exercises alter column user_id set not null;

-- ── 4. Row level security ───────────────────────────────────────────────────
alter table exercises enable row level security;

drop policy if exists "own exercises" on exercises;
create policy "own exercises"
  on exercises for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 5. Index for the per-user reads (grouped by day, ordered within a day) ──
create index if not exists exercises_user_day_idx
  on exercises (user_id, day_type, sort_order);
