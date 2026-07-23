-- Part 2 of 5 of 11-server-side-xp.sql
-- grind_recompute_stats() — the derivation engine
--
-- The full migration is one ~21KB file, which the Supabase SQL editor
-- truncates mid-function. These parts are split at safe statement
-- boundaries. Run them IN ORDER, each on its own. Every part is
-- idempotent, so re-running one is harmless.
--
-- Part 5 is the one that REVOKES client stat writes — it breaks the old
-- deployed client, so run it immediately before deploying the new code.

begin;

-- ── The recompute ───────────────────────────────────────────────────────────
-- Rebuilds every derived value for one user. security definer so it can write
-- `user_stats` after client writes are revoked below.

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

  -- 2. Streak day for every workout date (classic gaps-and-islands: subtracting
  --    a dense row number from consecutive dates yields a constant per run).
  create temporary table if not exists _grind_runs (
    d date primary key, streak_day int, run_len int
  ) on commit drop;
  delete from _grind_runs;

  insert into _grind_runs (d, streak_day, run_len)
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
  numbered as (
    select d, grp,
           row_number() over (partition by grp order by d)::int as streak_day,
           count(*)     over (partition by grp)::int             as run_len
      from grouped
  )
  select d, streak_day, run_len from numbered;

  -- 3. XP: 100 per completed session, +25 per PR set, +50 when that session's
  --    streak day is a multiple of 7.
  with per_session as (
    select s.id,
           s.local_date,
           100
           + 25 * coalesce((
               select count(*) from session_logs sl
                where sl.session_id = s.id and sl.is_pr = true
             ), 0)
           + case
               when r.streak_day is not null and r.streak_day % 7 = 0 then 50
               else 0
             end as xp
      from sessions s
      left join _grind_runs r on r.d = s.local_date
     where s.user_id = p_user
       and s.completed_at is not null
  )
  select coalesce(sum(xp), 0), count(*)
    into v_xp_total, v_total_workouts
    from per_session;

  -- Keep each session's own xp_earned consistent with the derivation, so the
  -- "this will remove N XP" copy on the delete-past-workout screen is honest.
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
        left join _grind_runs r on r.d = s2.local_date
       where s2.user_id = p_user
         and s2.completed_at is not null
    ) ps
   where s.id = ps.id
     and s.xp_earned is distinct from ps.xp;

  -- 4. Streaks.
  select max(d), max(run_len) into v_last_date, v_longest_streak from _grind_runs;

  if v_last_date is not null then
    -- A streak survives only if the last workout was today or yesterday, in the
    -- user's own calendar. Otherwise it has lapsed.
    if v_today - v_last_date <= 1 then
      select run_len into v_current_streak from _grind_runs where d = v_last_date;
    else
      v_current_streak := 0;
    end if;
  end if;

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
