-- Part 2 of 2 of 10-leaderboard-authz.sql
-- Supporting indexes + data sanity constraints.
-- Run AFTER 10a-leaderboard-function.sql.

-- ── Supporting indexes ──────────────────────────────────────────────────────
-- The authorization CTE runs on every leaderboard call, and the category branch
-- aggregates every completed session of every friend. Without these the RPC is
-- a sequential scan that gets linearly worse as the user base grows.

create index if not exists friendships_requester_idx
  on friendships (requester_id, status);
create index if not exists friendships_addressee_idx
  on friendships (addressee_id, status);
create index if not exists sessions_user_completed_idx
  on sessions (user_id, completed_at desc) where completed_at is not null;
create index if not exists session_logs_session_idx
  on session_logs (session_id);
-- Username search (`ilike '%q%'`) can't use a btree index; trigram can.
create extension if not exists pg_trgm;
create index if not exists user_profiles_username_trgm_idx
  on user_profiles using gin (username gin_trgm_ops);

-- ── Data sanity constraints ─────────────────────────────────────────────────
-- Weights and reps are self-reported, so they can never be fully trusted — but
-- they can be kept inside physically plausible bounds so one troll can't park a
-- 10,000 lb bench at the top of every leaderboard forever. Values are canonical
-- POUNDS (see CLAUDE.md → Units).
--
-- Guarded by a DO block: if existing rows already violate these, the ALTER would
-- fail and abort the whole migration. Instead we skip and warn, so you can clean
-- up and re-run.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'session_logs_weight_sane'
  ) then
    begin
      alter table session_logs
        add constraint session_logs_weight_sane
        check (weight is null or (weight >= 0 and weight <= 2000));
    exception when check_violation then
      raise warning 'Skipped session_logs_weight_sane: existing rows are out of range (0-2000 lbs). Clean them up and re-run.';
    end;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'session_logs_reps_sane'
  ) then
    begin
      alter table session_logs
        add constraint session_logs_reps_sane
        check (reps is null or (reps >= 0 and reps <= 1000));
    exception when check_violation then
      raise warning 'Skipped session_logs_reps_sane: existing rows are out of range (0-1000 reps). Clean them up and re-run.';
    end;
  end if;
end $$;
