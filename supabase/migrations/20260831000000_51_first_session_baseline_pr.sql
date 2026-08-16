-- Phase 51: first completed session per exercise is the PR baseline, not a PR.
-- (tracked copy of docs/sql/51-first-session-baseline-pr.sql)
-- Idempotent. Apply AFTER 50.
--
-- WHY
-- ---
-- grind_recompute_stats treated a missing prior_best as -1, so the first
-- working set of an exercise always flagged is_pr. That awards +25 XP and
-- the first_pr badge on a baseline lift instead of on a later improvement.
-- A set is now a PR only when an earlier completed session exists for that
-- exercise AND this set's volume beats that prior best.
--
-- Body is the 15-volume-based-prs definition with the flags CTE predicate
-- changed and grind.allow_session_complete set so a SQL-editor apply can
-- UPDATE completed session_logs / sessions.xp_earned (the definer bypass
-- does not fire when current_user = session_user). Later migrations (39/43)
-- updated grind_dates_connected in place; this replace still calls those
-- helpers.

begin;

create or replace function public.grind_recompute_stats(p_user uuid, p_local_date date default null)
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
  -- SQL editor / owner-as-invoker: current_user = session_user, so the
  -- security-definer bypass in grind_guard_completed_session_logs and
  -- grind_guard_session_write does not fire. Same GUC complete_session sets.
  perform set_config('grind.allow_session_complete', '1', true);

  -- 1. Recompute PR flags.
  --    A set is a PR when its VOLUME (weight x reps) beats the best
  --    non-warm-up volume from any EARLIER completed session for the same
  --    exercise. The first completed session for an exercise is the baseline
  --    (prior_best is null) and never a PR. Every set within one session
  --    shares the same baseline, so matching the same top volume twice in a
  --    session doesn't count twice.
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
             and p.prior_best is not null
             and (sl.weight * sl.reps) > p.prior_best) as pr
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
  --    (2b) below AND the streak totals (4).
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

  -- 2b. Per-session XP.
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

  -- 3. Totals.
  select coalesce(sum(xp_earned), 0), count(*)
    into v_xp_total, v_total_workouts
    from sessions
   where user_id = p_user
     and completed_at is not null;

  -- 4. Streaks.
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

revoke all on function public.grind_recompute_stats(uuid, date) from public, anon, authenticated;

-- Recompute existing users so first-session is_pr flags and XP drop in line
-- with the new rule. Badges already awarded are left as-is (award-only).
-- The GUC is also set here so a dashboard paste still works if this block
-- is run on its own after a previous 51 attempt replaced the function.
do $$
declare
  uid uuid;
begin
  perform set_config('grind.allow_session_complete', '1', true);
  for uid in
    select distinct user_id from public.sessions
  loop
    perform public.grind_recompute_stats(uid, null);
  end loop;
end;
$$;

commit;
