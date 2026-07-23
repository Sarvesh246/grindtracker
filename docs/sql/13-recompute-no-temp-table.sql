-- Phase 13: remove the temporary table from grind_recompute_stats().
-- Idempotent: safe to re-run. Apply this on any environment that already ran 11.
--
-- WHY THIS EXISTS
-- ---------------
-- `complete_session` (and every other stats RPC) calls `grind_recompute_stats`,
-- which built a per-run gaps-and-islands table as a session-local TEMP TABLE:
--
--     create temporary table if not exists _grind_runs (...) on commit drop;
--
-- That is a latent failure under Supabase's pooled PostgREST connections.
-- PostgREST keeps a pool of backend connections and runs with prepared
-- statements on. A PL/pgSQL function that references a temp table caches a
-- query plan bound to that temp table's OID. `on commit drop` destroys the
-- table at the end of the request's transaction, so the NEXT request that lands
-- on the same pooled backend recreates `_grind_runs` with a brand-new OID while
-- the cached plan still points at the old, dropped one. The recompute then
-- fails deep inside the function with:
--
--     ERROR: relation "_grind_runs" does not exist          (or)
--     ERROR: cache lookup failed for relation NNNNN
--
-- The symptom on the client is "Could not finish workout. Check your connection
-- and try again." on a perfectly good connection — and because the error is
-- deterministic (it recurs on every warmed backend), the client's retry/backoff
-- from migration-era hardening can't recover from it. Finishing a workout is the
-- hottest caller, so it's where users hit it.
--
-- THE FIX
-- -------
-- Compute the runs inline as ordinary CTEs. No temp table, no cross-transaction
-- plan cache to invalidate. The derivation is byte-for-byte equivalent:
--   * per-session XP is written to sessions.xp_earned exactly as before, then
--     the totals are summed straight off that column (one source of truth
--     instead of computing the same arithmetic twice), and
--   * the three streak numbers (last date, longest run, current run) collapse
--     out of the same gaps-and-islands runs in a single query.
--
-- This is a drop-in `create or replace`; grants are unchanged.

begin;

create or replace function grind_recompute_stats(p_user uuid, p_local_date date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today          date := coalesce(p_local_date, (now() at time zone 'utc')::date);
  v_xp_total       numeric := 0;
  v_total_workouts int := 0;
  v_last_date      date;
  v_current_streak int := 0;
  v_longest_streak int := 0;
begin
  -- 1. Recompute PR flags.
  --    A set is a PR when its weight beats the best non-warm-up weight from any
  --    EARLIER completed session for the same exercise. Every set within one
  --    session shares the same baseline, so hitting the same top weight twice in
  --    a session doesn't count twice.
  with sess as (
    select s.id as session_id, s.completed_at, sl.exercise_id,
           max(sl.weight) as session_max
      from sessions s
      join session_logs sl on sl.session_id = s.id
     where s.user_id = p_user
       and s.completed_at is not null
       and sl.is_warmup = false
       and sl.weight is not null
     group by s.id, s.completed_at, sl.exercise_id
  ),
  prior as (
    select session_id, exercise_id,
           max(session_max) over (
             partition by exercise_id
             order by completed_at, session_id
             rows between unbounded preceding and 1 preceding
           ) as prior_best
      from sess
  ),
  flags as (
    select sl.id,
           (sl.is_warmup = false
             and sl.weight is not null
             and sl.weight > coalesce(p.prior_best, -1)) as pr
      from session_logs sl
      join sessions s on s.id = sl.session_id
      left join prior p
        on p.session_id = sl.session_id
       and p.exercise_id = sl.exercise_id
     where s.user_id = p_user
       and s.completed_at is not null
  )
  update session_logs sl
     set is_pr = f.pr
    from flags f
   where sl.id = f.id
     and sl.is_pr is distinct from f.pr;

  -- 2. Per-session XP → sessions.xp_earned: 100 per completed session, +25 per
  --    PR set, +50 when that session's streak day is a multiple of 7.
  --    `streak_day` is the day's position within its consecutive-date run,
  --    derived by the classic gaps-and-islands trick (a date minus its dense row
  --    number is constant within a run). Computed inline as a CTE — NOT a temp
  --    table — so nothing survives the transaction to poison a cached plan.
  with dates as (
    select distinct local_date as d
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
  ),
  grouped as (
    select d, d - (row_number() over (order by d))::int as grp
      from dates
  ),
  runs as (
    select d,
           row_number() over (partition by grp order by d)::int as streak_day
      from grouped
  )
  update sessions s
     set xp_earned = ps.xp
    from (
      select s2.id,
             100
             + 25 * coalesce((
                 select count(*) from session_logs sl
                  where sl.session_id = s2.id and sl.is_pr = true
               ), 0)
             + case
                 when r.streak_day is not null and r.streak_day % 7 = 0 then 50
                 else 0
               end as xp
        from sessions s2
        left join runs r on r.d = s2.local_date
       where s2.user_id = p_user
         and s2.completed_at is not null
    ) ps
   where s.id = ps.id
     and s.xp_earned is distinct from ps.xp;

  -- 3. Totals straight off the freshly-written per-session XP — one source of
  --    truth, no duplicated arithmetic.
  select coalesce(sum(xp_earned), 0), count(*)
    into v_xp_total, v_total_workouts
    from sessions
   where user_id = p_user
     and completed_at is not null;

  -- 4. Streaks — the same gaps-and-islands runs, collapsed to the three numbers
  --    we store. A streak survives only if the last workout was today or
  --    yesterday in the user's own calendar; otherwise it has lapsed.
  with dates as (
    select distinct local_date as d
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
  ),
  grouped as (
    select d, d - (row_number() over (order by d))::int as grp
      from dates
  ),
  runs as (
    select d, count(*) over (partition by grp)::int as run_len
      from grouped
  ),
  last_run as (
    select d, run_len from runs order by d desc limit 1
  )
  select
    (select d from last_run),
    (select coalesce(max(run_len), 0) from runs),
    case
      when (select d from last_run) is null then 0
      when v_today - (select d from last_run) <= 1 then (select run_len from last_run)
      else 0
    end
  into v_last_date, v_longest_streak, v_current_streak;

  -- 5. Persist.
  insert into user_stats (
    user_id, xp_total, level, current_streak, longest_streak,
    last_workout_date, total_workouts, updated_at
  )
  values (
    p_user, v_xp_total, grind_level_for_xp(v_xp_total),
    coalesce(v_current_streak, 0), coalesce(v_longest_streak, 0),
    v_last_date, v_total_workouts, now()
  )
  on conflict (user_id) do update set
    xp_total          = excluded.xp_total,
    level             = excluded.level,
    current_streak    = excluded.current_streak,
    longest_streak    = greatest(user_stats.longest_streak, excluded.longest_streak),
    last_workout_date = excluded.last_workout_date,
    total_workouts    = excluded.total_workouts,
    updated_at        = now();
end;
$$;

revoke all on function grind_recompute_stats(uuid, date) from public, anon, authenticated;

commit;
