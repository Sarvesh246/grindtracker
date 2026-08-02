-- Phase 15: volume-based PR detection.
-- Idempotent: safe to re-run. Apply after 14-rest-days.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- `grind_recompute_stats()` flagged a set as a PR when its raw WEIGHT beat the
-- best non-warm-up weight from any earlier completed session for that
-- exercise — reps never entered into it. That rewards a heavier single at
-- low reps over a genuinely harder set: 200lb x 3 (600lb total) registered as
-- a PR over a prior 180lb x 8 (1440lb total), which isn't the bigger lift.
--
-- THE APPROACH
-- ------------
-- Step 1 of `grind_recompute_stats()` now compares WEIGHT x REPS (volume)
-- per set instead of weight alone — same "beats the best from any earlier
-- completed session" shape, same warm-up exclusion, just a different scalar.
-- Everything else in the function (XP, streaks, totals) is untouched; this
-- is a straight `create or replace` of the full body copied from
-- 14-rest-days.sql with only the step-1 CTEs changed, so re-running 14 after
-- this would silently revert it — always apply in file order.
--
-- `complete_session()`'s pr_exercises aggregation (feeds the completion
-- modal's "NEW PR" list) picked, per exercise, the max WEIGHT among this
-- session's PR sets. With volume-based PRs that no longer necessarily
-- identifies the actual record-setting set (e.g. a 90lb x 12 PR would be
-- reported as some other, heavier-but-not-PR set's weight if one existed in
-- the same session). It now picks the PR set with the highest volume per
-- exercise and returns its reps alongside its weight so the client can show
-- both.
--
-- Nothing here changes ownership/authorization — both functions stay
-- security definer, revoked from direct client execution, same as 11/13/14.

begin;

-- ── grind_recompute_stats — volume-based PR flags ──────────────────────────
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

  v_dates       date[];
  v_run_id      int[];
  v_streak_day  int[];
  v_run_len     int[];
  v_n           int;
  v_i           int;
begin
  -- 1. Recompute PR flags.
  --    A set is a PR when its VOLUME (weight x reps) beats the best
  --    non-warm-up volume from any EARLIER completed session for the same
  --    exercise. Every set within one session shares the same baseline, so
  --    matching the same top volume twice in a session doesn't count twice.
  with sess as (
    select s.id as session_id, s.completed_at, sl.exercise_id,
           max(sl.weight * sl.reps) as session_max
      from sessions s
      join session_logs sl on sl.session_id = s.id
     where s.user_id = p_user
       and s.completed_at is not null
       and sl.is_warmup = false
       and sl.weight is not null
       and sl.reps is not null
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
             and sl.reps is not null
             and (sl.weight * sl.reps) > coalesce(p.prior_best, -1)) as pr
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

  -- 2a. Build rest-day-aware runs, once, reused by the XP milestone bonus
  --    (2b) below AND the streak totals (4). Unchanged from 14.
  v_dates := array(
    select distinct local_date
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
     order by local_date
  );

  v_n := coalesce(array_length(v_dates, 1), 0);

  v_run_id     := array_fill(0, array[v_n]);
  v_streak_day := array_fill(0, array[v_n]);
  v_run_len    := array_fill(0, array[v_n]);

  if v_n > 0 then
    v_run_id[1]     := 1;
    v_streak_day[1] := 1;

    for v_i in 2 .. v_n loop
      if grind_dates_connected(p_user, v_dates[v_i - 1], v_dates[v_i]) then
        v_run_id[v_i]     := v_run_id[v_i - 1];
        v_streak_day[v_i] := v_streak_day[v_i - 1] + 1;
      else
        v_run_id[v_i]     := v_run_id[v_i - 1] + 1;
        v_streak_day[v_i] := 1;
      end if;
    end loop;

    v_run_len[v_n] := v_streak_day[v_n];
    for v_i in reverse (v_n - 1) .. 1 loop
      if v_run_id[v_i] = v_run_id[v_i + 1] then
        v_run_len[v_i] := v_run_len[v_i + 1];
      else
        v_run_len[v_i] := v_streak_day[v_i];
      end if;
    end loop;
  end if;

  -- 2b. Per-session XP. Unchanged from 14.
  with runs as (
    select ud.d, sd.streak_day
      from unnest(v_dates) with ordinality as ud(d, ord)
      join unnest(v_streak_day) with ordinality as sd(streak_day, ord)
        on sd.ord = ud.ord
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

  -- 3. Totals. Unchanged from 14.
  select coalesce(sum(xp_earned), 0), count(*)
    into v_xp_total, v_total_workouts
    from sessions
   where user_id = p_user
     and completed_at is not null;

  -- 4. Streaks. Unchanged from 14.
  if v_n = 0 then
    v_last_date      := null;
    v_longest_streak := 0;
    v_current_streak := 0;
  else
    v_last_date := v_dates[v_n];

    select coalesce(max(x), 0) into v_longest_streak from unnest(v_run_len) as x;

    if grind_dates_connected(p_user, v_last_date, v_today) then
      v_current_streak := v_run_len[v_n];
    else
      v_current_streak := 0;
    end if;
  end if;

  -- 5. Persist. Unchanged from 14.
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

-- ── complete_session — PR list now includes reps, picked by volume ────────
create or replace function complete_session(
  p_session_id uuid,
  p_local_date date default null,
  p_note       text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_date      date := grind_safe_local_date(p_local_date);
  v_prev_xp   numeric := 0;
  v_prev_lvl  int := 1;
  v_row       user_stats%rowtype;
  v_xp_earned int := 0;
  v_prs       json;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not exists (
    select 1 from sessions
     where id = p_session_id and user_id = v_user and completed_at is null
  ) then
    raise exception 'SESSION_NOT_OPEN: not found, not yours, or already completed'
      using errcode = '42501';
  end if;

  select coalesce(xp_total, 0), coalesce(level, 1)
    into v_prev_xp, v_prev_lvl
    from user_stats where user_id = v_user;

  update sessions
     set completed_at = now(),
         local_date   = v_date,
         note         = coalesce(p_note, note)
   where id = p_session_id;

  perform grind_recompute_stats(v_user, v_date);

  select * into v_row from user_stats where user_id = v_user;
  select xp_earned into v_xp_earned from sessions where id = p_session_id;

  -- PR exercises for this session, for the modal's "NEW PR" list. Picks the
  -- highest-VOLUME PR set per exercise (not just the heaviest) and returns
  -- its weight and reps together, since a PR can now be a higher-rep set at
  -- a lower weight than some other, non-PR set logged in the same session.
  select coalesce(json_agg(json_build_object('name', e.name, 'weight', x.w, 'reps', x.r)), '[]'::json)
    into v_prs
    from (
      select distinct on (sl.exercise_id) sl.exercise_id, sl.weight as w, sl.reps as r
        from session_logs sl
       where sl.session_id = p_session_id and sl.is_pr = true
       order by sl.exercise_id, (sl.weight * sl.reps) desc
    ) x
    join exercises e on e.id = x.exercise_id;

  return json_build_object(
    'xp_earned',      v_xp_earned,
    'xp_total',       v_row.xp_total,
    'prev_level',     v_prev_lvl,
    'level',          v_row.level,
    'leveled_up',     v_row.level > v_prev_lvl,
    'current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak,
    'last_workout_date', v_row.last_workout_date,
    'total_workouts', v_row.total_workouts,
    'pr_count',       (select count(*) from session_logs
                        where session_id = p_session_id and is_pr = true),
    'pr_exercises',   v_prs
  );
end;
$$;

revoke all on function complete_session(uuid, date, text) from public, anon;
grant execute on function complete_session(uuid, date, text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════════
--  DRY RUN — applying this migration recomputes is_pr for every existing set
--  (it changes the comparison basis, so old PR flags can flip). To preview the
--  effect on a staging copy before running against prod: snapshot
--  `session_logs.is_pr` for a test user, call
--  `select grind_recompute_stats(that_user_id);`, then diff the flags before
--  vs. after. A precise standalone read-only query would have to reimplement
--  the same per-exercise, per-session window function as step 1 above, so the
--  recompute-and-diff approach is simpler and exactly matches what the
--  migration actually does.
-- ════════════════════════════════════════════════════════════════════════════
