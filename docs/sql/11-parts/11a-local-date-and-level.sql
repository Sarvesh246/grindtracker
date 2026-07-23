-- Part 1 of 5 of 11-server-side-xp.sql
-- sessions.local_date column, backfill, index, grind_level_for_xp()
--
-- The full migration is one ~21KB file, which the Supabase SQL editor
-- truncates mid-function. These parts are split at safe statement
-- boundaries. Run them IN ORDER, each on its own. Every part is
-- idempotent, so re-running one is harmless.
--
-- Part 5 is the one that REVOKES client stat writes — it breaks the old
-- deployed client, so run it immediately before deploying the new code.

begin;

-- ── Local workout date ──────────────────────────────────────────────────────
-- Streak logic is timezone-sensitive (see CLAUDE.md → Dates & timezones) and
-- Postgres only sees a UTC `completed_at`, so the user's local calendar date
-- has to be recorded explicitly. Backfilled from UTC for existing rows — an
-- approximation for history, exact from here on because the client passes it.

alter table sessions add column if not exists local_date date;

update sessions
   set local_date = (completed_at at time zone 'utc')::date
 where local_date is null
   and completed_at is not null;

create index if not exists sessions_user_localdate_idx
  on sessions (user_id, local_date) where completed_at is not null;

-- ── Level curve ─────────────────────────────────────────────────────────────
-- Mirrors getLevel() in src/lib/utils/gamification.ts. If you change one,
-- change both.

create or replace function grind_level_for_xp(p_xp numeric)
returns int
language sql immutable
set search_path = public
as $$
  select greatest(1, floor((1 + sqrt(1 + 8 * greatest(p_xp, 0) / 500.0)) / 2)::int);
$$;

commit;
