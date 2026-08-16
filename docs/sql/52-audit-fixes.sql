-- Phase 52: fixes from a full-codebase correctness audit.
-- Idempotent. Apply AFTER 51.
--
-- Paste this whole file into the Supabase SQL editor.
--
-- WHY
-- ---
-- 1. grind_recompute_stats awarded the +50 streak-milestone XP bonus once per
--    SESSION sharing a milestone local_date instead of once per DATE. Flex
--    days (08-flex-days.sql) let a user legitimately complete two sessions
--    (different day_type) on the same local_date, so a milestone day with a
--    flex session paid the bonus twice. Fixed by only awarding it to the
--    earliest-started completed session on that date.
-- 2. grind_safe_local_date was declared IMMUTABLE while its body reads
--    now() — a real misdeclaration (the sibling grind_safe_past_date was
--    already fixed to STABLE in 38-schema-integrity.sql with the same
--    reasoning). Under IMMUTABLE, Postgres is permitted to constant-fold or
--    cache the result within a plan, which is unsound for a function whose
--    answer changes every day.
-- 3. award_earned_badges's all_three_days/weekend_warrior weekly window used
--    date_trunc('week', ...) (UTC, Monday-start) compared against
--    sessions.local_date (a per-user LOCAL calendar date) — inconsistent
--    with 48-week-start-sunday.sql, which moved every other week-based
--    concept (rest budget, Home "this week") to grind_week_start's Sunday
--    start. Aligned to the same helper so all three agree.
-- 4. sessions.day_type was client-writable via column grant with no guard,
--    even after completed_at is set — a client could retroactively relabel a
--    completed session's category, skewing get_leaderboard's push/pull/legs
--    attribution and the all_three_days badge for that user's own data. The
--    write-guard trigger already protects completed_at/xp_earned/local_date;
--    extended to block day_type once a session is completed, while still
--    allowing it on an open (in-progress) session as documented in 11.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. grind_recompute_stats — streak-milestone bonus once per DATE, not per
--    session sharing that date
-- ════════════════════════════════════════════════════════════════════════════

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

  -- 2b. Per-session XP. The milestone bonus applies once per DATE (a
  --    calendar day either hits a streak milestone or it doesn't) — award it
  --    only to that date's earliest-started completed session, so a same-day
  --    flex session (08-flex-days.sql lets two sessions share a local_date)
  --    doesn't double it.
  with runs as (
    select ud.d, sd.streak_day
      from unnest(v_dates) with ordinality as ud(d, ord)
      join unnest(v_streak_day) with ordinality as sd(streak_day, ord)
        on sd.ord = ud.ord
  ),
  day_sessions as (
    select s2.id, s2.local_date,
           row_number() over (
             partition by s2.local_date
             order by s2.started_at, s2.id
           ) as rn
      from sessions s2
     where s2.user_id = p_user
       and s2.completed_at is not null
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
                 when r.streak_day is not null and r.streak_day % 7 = 0
                      and ds.rn = 1
                 then 50
                 else 0
               end as xp
        from sessions s2
        left join runs r on r.d = s2.local_date
        left join day_sessions ds on ds.id = s2.id
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

-- Recompute existing users so the deduped milestone bonus drops in line with
-- the new rule (a user who double-earned it on a flex-day milestone will see
-- xp_total/level correct downward by 50).
do $$
declare
  uid uuid;
begin
  for uid in select user_id from user_stats loop
    perform public.grind_recompute_stats(uid, null);
  end loop;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. grind_safe_local_date — STABLE, not IMMUTABLE (body reads now())
-- ════════════════════════════════════════════════════════════════════════════

create or replace function grind_safe_local_date(p_local_date date)
returns date
language sql stable
set search_path = public
as $$
  select least(
    greatest(coalesce(p_local_date, (now() at time zone 'utc')::date),
             (now() at time zone 'utc')::date - 1),
    (now() at time zone 'utc')::date + 1
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. award_earned_badges — weekly window aligned to grind_week_start
--    (Sunday, per 48-week-start-sunday.sql) instead of UTC date_trunc('week')
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.award_earned_badges()
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_stats user_stats%rowtype;
  v_metrics json;
  v_earned text[] := '{}';
  v_new text[] := '{}';
  v_id text;
  v_total_prs int := 0;
  v_level int := 1;
  v_had_comeback boolean := false;
  v_had_early_bird boolean := false;
  v_had_night_owl boolean := false;
  v_had_flawless boolean := false;
  v_has_full_split boolean := false;
  v_has_weekend boolean := false;
  v_dates date[];
  v_week_start date;
  v_candidates text[] := '{}';
  v_all_but_completionist text[] := array[
    'first_workout','first_pr','streak_3','streak_7','streak_14','streak_30','streak_60',
    'workouts_10','workouts_50','workouts_100','workouts_200','workouts_365',
    'all_three_days','weekend_warrior',
    'pr_5','pr_25','pr_50','pr_100',
    'level_5','level_10','level_15','level_20',
    'volume_100k','volume_500k','volume_1m',
    'plates_225','plates_315','plates_405',
    'early_bird','night_owl','comeback','flawless',
    'rest_day_set','not_alone','rep_machine','weight_tracked'
  ];
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_stats from user_stats where user_id = v_user;
  if v_stats.user_id is null then
    return '[]'::json;
  end if;

  select coalesce(array_agg(badge_id), '{}') into v_earned
    from user_badges where user_id = v_user;

  select count(*)::int into v_total_prs
    from session_logs sl
    join sessions s on s.id = sl.session_id
   where s.user_id = v_user and sl.is_pr = true;

  v_level := grind_level_for_xp(v_stats.xp_total);

  select json_build_object(
    'total_volume', coalesce((
      select sum(sl.weight * sl.reps)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = v_user and s.completed_at is not null
         and sl.weight is not null and sl.reps is not null
         and coalesce(sl.is_warmup, false) = false
         and coalesce(sl.is_skipped, false) = false
    ), 0),
    'max_set_weight', coalesce((
      select max(sl.weight)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = v_user and s.completed_at is not null
         and sl.weight is not null
         and coalesce(sl.is_warmup, false) = false
    ), 0),
    'max_set_reps', coalesce((
      select max(sl.reps)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = v_user and s.completed_at is not null
         and sl.reps is not null
         and coalesce(sl.is_warmup, false) = false
    ), 0),
    'has_recurring_rest_day', exists (
      select 1 from user_rest_days where user_id = v_user
    ),
    'has_accepted_friend', exists (
      select 1 from friendships
       where status = 'accepted'
         and (requester_id = v_user or addressee_id = v_user)
    ),
    'body_weight_log_count', (
      select count(*)::int from body_weights where user_id = v_user
    )
  ) into v_metrics;

  -- Comeback: 14+ calendar days between the last two distinct local_dates
  -- (matches badge copy "Return after a break of 14+ days").
  select array_agg(d order by d desc) into v_dates
    from (
      select distinct local_date as d
        from sessions
       where user_id = v_user and completed_at is not null and local_date is not null
       order by local_date desc
       limit 2
    ) q;
  if coalesce(array_length(v_dates, 1), 0) = 2 then
    v_had_comeback := (v_dates[1] - v_dates[2]) >= 14;
  end if;

  -- Sunday-start week (grind_week_start, 48-week-start-sunday.sql) — matches
  -- the rest budget / Home "this week" convention everywhere else, instead of
  -- the previous UTC Monday-start date_trunc('week').
  v_week_start := public.grind_week_start((now() at time zone 'utc')::date);

  select
    count(distinct case
      when coalesce(udc.category, s.day_type) = 'push' then 'push'
      when coalesce(udc.category, s.day_type) = 'pull' then 'pull'
      when coalesce(udc.category, s.day_type) = 'legs' then 'legs'
    end) = 3
    into v_has_full_split
    from sessions s
    left join user_day_categories udc
      on udc.user_id = v_user and udc.day_key = s.day_type
   where s.user_id = v_user
     and s.completed_at is not null
     and s.local_date is not null
     and s.local_date >= v_week_start
     and s.local_date < v_week_start + 7;

  select
    bool_or(extract(dow from s.local_date) = 0)
      and bool_or(extract(dow from s.local_date) = 6)
    into v_has_weekend
    from sessions s
   where s.user_id = v_user
     and s.completed_at is not null
     and s.local_date is not null
     and s.local_date >= v_week_start
     and s.local_date < v_week_start + 7;

  -- Time-of-day + flawless: derived from live-completed sessions only
  -- (start_hour is set by complete_session, not upsert_past_session).
  select exists (
    select 1 from sessions
     where user_id = v_user and completed_at is not null
       and start_hour is not null and start_hour < 7
  ) into v_had_early_bird;

  select exists (
    select 1 from sessions
     where user_id = v_user and completed_at is not null
       and start_hour is not null and start_hour >= 22
  ) into v_had_night_owl;

  select exists (
    select 1
      from sessions s
     where s.user_id = v_user
       and s.completed_at is not null
       and s.start_hour is not null
       and grind_session_has_working_set(s.id)
       and not exists (
         select 1 from session_logs sl
          where sl.session_id = s.id
            and coalesce(sl.is_skipped, false) = true
       )
  ) into v_had_flawless;

  if v_stats.total_workouts >= 1 then v_candidates := array_append(v_candidates, 'first_workout'); end if;
  if v_total_prs >= 1 then v_candidates := array_append(v_candidates, 'first_pr'); end if;
  if v_stats.current_streak >= 3 then v_candidates := array_append(v_candidates, 'streak_3'); end if;
  if v_stats.current_streak >= 7 then v_candidates := array_append(v_candidates, 'streak_7'); end if;
  if v_stats.current_streak >= 14 then v_candidates := array_append(v_candidates, 'streak_14'); end if;
  if v_stats.current_streak >= 30 then v_candidates := array_append(v_candidates, 'streak_30'); end if;
  if v_stats.current_streak >= 60 then v_candidates := array_append(v_candidates, 'streak_60'); end if;
  if v_stats.total_workouts >= 10 then v_candidates := array_append(v_candidates, 'workouts_10'); end if;
  if v_stats.total_workouts >= 50 then v_candidates := array_append(v_candidates, 'workouts_50'); end if;
  if v_stats.total_workouts >= 100 then v_candidates := array_append(v_candidates, 'workouts_100'); end if;
  if v_stats.total_workouts >= 200 then v_candidates := array_append(v_candidates, 'workouts_200'); end if;
  if v_stats.total_workouts >= 365 then v_candidates := array_append(v_candidates, 'workouts_365'); end if;
  if coalesce(v_has_full_split, false) then v_candidates := array_append(v_candidates, 'all_three_days'); end if;
  if coalesce(v_has_weekend, false) then v_candidates := array_append(v_candidates, 'weekend_warrior'); end if;
  if v_total_prs >= 5 then v_candidates := array_append(v_candidates, 'pr_5'); end if;
  if v_total_prs >= 25 then v_candidates := array_append(v_candidates, 'pr_25'); end if;
  if v_total_prs >= 50 then v_candidates := array_append(v_candidates, 'pr_50'); end if;
  if v_total_prs >= 100 then v_candidates := array_append(v_candidates, 'pr_100'); end if;
  if v_level >= 5 then v_candidates := array_append(v_candidates, 'level_5'); end if;
  if v_level >= 10 then v_candidates := array_append(v_candidates, 'level_10'); end if;
  if v_level >= 15 then v_candidates := array_append(v_candidates, 'level_15'); end if;
  if v_level >= 20 then v_candidates := array_append(v_candidates, 'level_20'); end if;
  if coalesce((v_metrics->>'total_volume')::numeric, 0) >= 100000 then
    v_candidates := array_append(v_candidates, 'volume_100k'); end if;
  if coalesce((v_metrics->>'total_volume')::numeric, 0) >= 500000 then
    v_candidates := array_append(v_candidates, 'volume_500k'); end if;
  if coalesce((v_metrics->>'total_volume')::numeric, 0) >= 1000000 then
    v_candidates := array_append(v_candidates, 'volume_1m'); end if;
  if coalesce((v_metrics->>'max_set_weight')::numeric, 0) >= 225 then
    v_candidates := array_append(v_candidates, 'plates_225'); end if;
  if coalesce((v_metrics->>'max_set_weight')::numeric, 0) >= 315 then
    v_candidates := array_append(v_candidates, 'plates_315'); end if;
  if coalesce((v_metrics->>'max_set_weight')::numeric, 0) >= 405 then
    v_candidates := array_append(v_candidates, 'plates_405'); end if;
  if v_had_early_bird then v_candidates := array_append(v_candidates, 'early_bird'); end if;
  if v_had_night_owl then v_candidates := array_append(v_candidates, 'night_owl'); end if;
  if v_had_comeback then v_candidates := array_append(v_candidates, 'comeback'); end if;
  if v_had_flawless then v_candidates := array_append(v_candidates, 'flawless'); end if;
  if coalesce((v_metrics->>'has_recurring_rest_day')::boolean, false) then
    v_candidates := array_append(v_candidates, 'rest_day_set'); end if;
  if coalesce((v_metrics->>'has_accepted_friend')::boolean, false) then
    v_candidates := array_append(v_candidates, 'not_alone'); end if;
  if coalesce((v_metrics->>'max_set_reps')::int, 0) >= 20 then
    v_candidates := array_append(v_candidates, 'rep_machine'); end if;
  if coalesce((v_metrics->>'body_weight_log_count')::int, 0) >= 5 then
    v_candidates := array_append(v_candidates, 'weight_tracked'); end if;

  foreach v_id in array v_candidates
  loop
    if not (v_id = any (v_earned)) then
      insert into user_badges (user_id, badge_id)
      values (v_user, v_id)
      on conflict do nothing;
      if found then
        v_new := array_append(v_new, v_id);
        v_earned := array_append(v_earned, v_id);
      end if;
    end if;
  end loop;

  if not ('completionist' = any (v_earned))
     and v_all_but_completionist <@ v_earned then
    insert into user_badges (user_id, badge_id)
    values (v_user, 'completionist')
    on conflict do nothing;
    if found then
      v_new := array_append(v_new, 'completionist');
    end if;
  end if;

  return to_json(v_new);
end;
$$;

revoke all on function public.award_earned_badges() from public, anon;
grant execute on function public.award_earned_badges() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. sessions.day_type locked once a session is completed
-- ════════════════════════════════════════════════════════════════════════════
-- The column stays client-writable (comment in 11-server-side-xp.sql: "keeps
-- the client able to rename a day") for an OPEN session, but a completed
-- session's day_type must not be retroactively changeable — it feeds
-- get_leaderboard's category attribution and the all_three_days badge.

create or replace function grind_guard_session_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- SECURITY DEFINER RPCs run as their owner, so current_user <> session_user.
  -- Direct PostgREST callers keep both equal to the invoker role — that's who
  -- we gate. Also honor an explicit transaction-local allow flag.
  if current_user is distinct from session_user
     or current_setting('grind.allow_session_complete', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.completed_at is not null
       or new.xp_earned is distinct from 0
       or new.local_date is not null then
      raise exception 'COMPLETED_SESSION_DIRECT_INSERT_FORBIDDEN'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if (old.completed_at is distinct from new.completed_at)
       or (old.xp_earned is distinct from new.xp_earned)
       or (old.local_date is distinct from new.local_date)
       or (old.completed_at is not null and old.day_type is distinct from new.day_type) then
      raise exception 'SESSION_COMPLETION_FIELDS_FORBIDDEN'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Trigger already points at this function by name (20-production-hardening.sql);
-- create or replace above is sufficient, no trigger redefinition needed.

commit;
