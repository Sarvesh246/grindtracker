-- Phase 38: production schema integrity
-- Idempotent: safe to re-run. Apply AFTER 37-coach-correct-weights.sql.
--
-- Paste this whole file into the Supabase SQL editor and run it BEFORE
-- deploying the app that calls award_earned_badges() with no args and
-- complete_session(..., p_start_hour).
--
-- Fixes:
--   1. award_earned_badges signature drift + client-trusted hour/skips
--   2. grind_safe_past_date maxed at UTC today (east-of-UTC past sessions)
--   3. Coach weight correction feeding a historical date into streak recompute
--   4. delete_my_grind_data missing Coach tables
--   5. Comeback badge: copy says 14+ days, SQL required >= 15

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. sessions.start_hour — wall-clock hour at live complete (0–23)
-- ════════════════════════════════════════════════════════════════════════════
-- Same trust model as p_local_date: the client (or notification_prefs.timezone)
-- supplies a local hour because Postgres only sees UTC. Stored on the row so
-- award_earned_badges no longer takes a client hour/skip flag.

alter table public.sessions
  add column if not exists start_hour smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sessions_start_hour_range'
  ) then
    alter table public.sessions
      add constraint sessions_start_hour_range
      check (start_hour is null or (start_hour >= 0 and start_hour <= 23));
  end if;
end $$;

comment on column public.sessions.start_hour is
  'Local wall-clock hour (0–23) when the session was live-completed. Null for past-logged sessions. Set only by complete_session.';

-- Direct PostgREST writes must not mint a start hour (would self-grant early_bird).
create or replace function grind_guard_session_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user is distinct from session_user
     or current_setting('grind.allow_session_complete', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.completed_at is not null
       or new.xp_earned is distinct from 0
       or new.local_date is not null
       or new.start_hour is not null then
      raise exception 'COMPLETED_SESSION_DIRECT_INSERT_FORBIDDEN'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if (old.completed_at is distinct from new.completed_at)
       or (old.xp_earned is distinct from new.xp_earned)
       or (old.local_date is distinct from new.local_date)
       or (old.start_hour is distinct from new.start_hour) then
      raise exception 'SESSION_COMPLETION_FIELDS_FORBIDDEN'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Best-effort backfill from the IANA tz already stored for streak reminders.
do $$
begin
  if to_regclass('public.notification_prefs') is null then
    return;
  end if;
  update public.sessions s
     set start_hour = extract(hour from (s.started_at at time zone np.timezone))::int
    from public.notification_prefs np
   where np.user_id = s.user_id
     and s.start_hour is null
     and s.completed_at is not null
     and np.timezone is not null
     and np.timezone <> 'UTC'
     and exists (select 1 from pg_timezone_names t where t.name = np.timezone);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. grind_safe_past_date — UTC+1 max (matches the comment + grind_safe_local_date)
-- ════════════════════════════════════════════════════════════════════════════
-- STABLE, not IMMUTABLE: the body reads now(). Max is UTC today+1 so a user
-- east of UTC can log/edit "today" without the date being rewritten to yesterday.

create or replace function grind_safe_past_date(p_local_date date)
returns date
language sql
stable
set search_path = public
as $$
  select least(
    greatest(
      coalesce(p_local_date, (now() at time zone 'utc')::date - 1),
      (now() at time zone 'utc')::date - 730
    ),
    (now() at time zone 'utc')::date + 1
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. complete_session — persist start_hour (4th arg, defaulted)
-- ════════════════════════════════════════════════════════════════════════════
-- DROP + CREATE: CREATE OR REPLACE cannot add a parameter. Defaults keep the
-- existing 3-arg PostgREST payload working. Apply this before the app that
-- sends p_start_hour.

drop function if exists public.complete_session(uuid, date);
drop function if exists public.complete_session(uuid, date, text);
drop function if exists public.complete_session(uuid, date, text, integer);

create function public.complete_session(
  p_session_id uuid,
  p_local_date date default null,
  p_note       text default null,
  p_start_hour int default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user       uuid := auth.uid();
  v_date       date := grind_safe_local_date(p_local_date);
  v_prev_xp    numeric := 0;
  v_prev_lvl   int := 1;
  v_row        user_stats%rowtype;
  v_xp_earned  int := 0;
  v_prs        json;
  v_start_hour int := null;
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

  if not grind_session_has_working_set(p_session_id) then
    raise exception 'NO_WORKING_SETS: log at least one set before finishing'
      using errcode = '22023';
  end if;

  -- Client hour first (same trust model as p_local_date). Fall back to the
  -- IANA tz already stored for streak reminders when the caller omits it.
  if p_start_hour is not null and p_start_hour between 0 and 23 then
    v_start_hour := p_start_hour;
  elsif to_regclass('public.notification_prefs') is not null then
    select extract(hour from (s.started_at at time zone np.timezone))::int
      into v_start_hour
      from sessions s
      join notification_prefs np on np.user_id = s.user_id
     where s.id = p_session_id
       and np.timezone is not null
       and exists (select 1 from pg_timezone_names t where t.name = np.timezone);
  end if;

  select coalesce(xp_total, 0), coalesce(level, 1)
    into v_prev_xp, v_prev_lvl
    from user_stats where user_id = v_user;

  perform set_config('grind.allow_session_complete', '1', true);

  update sessions
     set completed_at = now(),
         local_date   = v_date,
         note         = coalesce(p_note, note),
         start_hour   = v_start_hour
   where id = p_session_id;

  perform grind_recompute_stats(v_user, v_date);

  select * into v_row from user_stats where user_id = v_user;
  select xp_earned into v_xp_earned from sessions where id = p_session_id;

  -- One entry per PR *set*, real weight×reps pair, volume-desc for the modal.
  select coalesce(json_agg(json_build_object(
           'name', coalesce(e.name, 'Exercise'),
           'weight', sl.weight,
           'reps', sl.reps
         ) order by (sl.weight * sl.reps) desc, sl.set_number), '[]'::json)
    into v_prs
    from session_logs sl
    left join exercises e on e.id = sl.exercise_id
   where sl.session_id = p_session_id
     and sl.is_pr = true
     and sl.weight is not null
     and sl.reps is not null;

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

revoke all on function public.complete_session(uuid, date, text, integer) from public, anon;
grant execute on function public.complete_session(uuid, date, text, integer) to authenticated;

-- Undo clears the stored hour so a later re-complete writes a fresh one.
create or replace function public.uncomplete_session(
  p_session_id uuid,
  p_local_date date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  user_stats%rowtype;
  v_completed_at timestamptz;
  v_stored_date date;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select completed_at, local_date
    into v_completed_at, v_stored_date
    from sessions
   where id = p_session_id and user_id = v_user and completed_at is not null;

  if v_completed_at is null then
    raise exception 'SESSION_NOT_COMPLETED: not found, not yours, or already open'
      using errcode = '42501';
  end if;

  if v_completed_at < now() - interval '10 minutes' then
    raise exception 'UNDO_WINDOW_EXPIRED'
      using errcode = '22023';
  end if;

  perform set_config('grind.allow_session_complete', '1', true);

  update sessions
     set completed_at = null, xp_earned = 0, local_date = null, start_hour = null
   where id = p_session_id;

  perform grind_recompute_stats(
    v_user,
    grind_safe_local_date(coalesce(v_stored_date, p_local_date))
  );

  select * into v_row from user_stats where user_id = v_user;
  return json_build_object(
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'total_workouts', v_row.total_workouts
  );
end;
$$;

revoke all on function public.uncomplete_session(uuid, date) from public, anon;
grant execute on function public.uncomplete_session(uuid, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. award_earned_badges() — no client hour/skip args
-- ════════════════════════════════════════════════════════════════════════════
-- Create the zero-arg function FIRST, then replace the old overloads with
-- wrappers that ignore their arguments. Otherwise `select award_earned_badges()`
-- inside a defaulted (int, boolean) body would recurse into itself.

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

  v_week_start := date_trunc('week', (now() at time zone 'utc')::timestamp)::date;

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

-- Old clients still send these; values are ignored. No DEFAULT on the
-- wrappers — otherwise `award_earned_badges()` is ambiguous with the
-- zero-arg function. Drop first so we can drop the old defaults.
drop function if exists public.award_earned_badges(int, boolean);
drop function if exists public.award_earned_badges(timestamptz, boolean);

create function public.award_earned_badges(
  p_start_hour int,
  p_had_no_skips boolean
)
returns json
language sql
security definer
set search_path = public
as $$
  select public.award_earned_badges();
$$;

revoke all on function public.award_earned_badges(int, boolean) from public, anon;
grant execute on function public.award_earned_badges(int, boolean) to authenticated;

create function public.award_earned_badges(
  p_session_started_at timestamptz,
  p_had_no_skips boolean
)
returns json
language sql
security definer
set search_path = public
as $$
  select public.award_earned_badges();
$$;

revoke all on function public.award_earned_badges(timestamptz, boolean) from public, anon;
grant execute on function public.award_earned_badges(timestamptz, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Coach weight correction — never recompute streaks against a historical date
-- ════════════════════════════════════════════════════════════════════════════
-- grind_safe_local_date() clamps old dates to UTC-1, which can sit more than
-- one day before a live "today" workout and zero current_streak. Match
-- upsert_past_session: always recompute against grind_safe_local_date(null).

create or replace function public.coach_correct_session_weights(
  p_session_id uuid,
  p_exercise_id uuid,
  p_from_weight_lbs numeric,
  p_to_weight_lbs numeric,
  p_local_date date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user    uuid := auth.uid();
  v_updated int := 0;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_session_id is null or p_exercise_id is null then
    raise exception 'ARGS_REQUIRED' using errcode = '22023';
  end if;

  if p_from_weight_lbs is null or p_to_weight_lbs is null then
    raise exception 'WEIGHTS_REQUIRED' using errcode = '22023';
  end if;

  if abs(p_from_weight_lbs - p_to_weight_lbs) < 0.051 then
    raise exception 'WEIGHTS_UNCHANGED' using errcode = '22023';
  end if;

  if not exists (
    select 1
      from sessions s
     where s.id = p_session_id
       and s.user_id = v_user
       and s.completed_at is not null
  ) then
    raise exception 'SESSION_NOT_FOUND' using errcode = '42501';
  end if;

  update session_logs sl
     set weight = p_to_weight_lbs
   where sl.session_id = p_session_id
     and sl.exercise_id = p_exercise_id
     and sl.weight is not null
     and coalesce(sl.is_skipped, false) = false
     and abs(sl.weight - p_from_weight_lbs) < 0.051;

  get diagnostics v_updated = row_count;

  if v_updated < 1 then
    raise exception 'NO_MATCHING_SETS' using errcode = '22023';
  end if;

  -- p_local_date is accepted for call-site compatibility and ignored: streak
  -- grouping must use "today", not the session being corrected.
  perform grind_recompute_stats(v_user, grind_safe_local_date(null));

  return json_build_object(
    'updated_sets', v_updated,
    'session_id', p_session_id
  );
end;
$$;

revoke all on function public.coach_correct_session_weights(uuid, uuid, numeric, numeric, date)
  from public, anon;
grant execute on function public.coach_correct_session_weights(uuid, uuid, numeric, numeric, date)
  to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. delete_my_grind_data — also wipe Coach tables
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.delete_my_grind_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  delete from public.session_logs
    where session_id in (select id from public.sessions where user_id = uid);
  delete from public.sessions where user_id = uid;
  delete from public.exercises where user_id = uid;
  delete from public.user_stats where user_id = uid;
  delete from public.user_badges where user_id = uid;
  delete from public.body_weights where user_id = uid;
  delete from public.user_day_categories where user_id = uid;
  delete from public.user_rotation where user_id = uid;
  delete from public.user_rest_days where user_id = uid;
  delete from public.user_rest_dates where user_id = uid;
  delete from public.feedback where user_id = uid;
  delete from public.friendships
    where requester_id = uid or addressee_id = uid;

  if to_regclass('public.progress_photo_groups') is not null then
    delete from public.progress_photos
      where group_id in (select id from public.progress_photo_groups where user_id = uid);
    delete from public.progress_photo_groups where user_id = uid;
  end if;

  if to_regclass('public.push_subscriptions') is not null then
    delete from public.push_subscriptions where user_id = uid;
  end if;
  if to_regclass('public.notification_prefs') is not null then
    delete from public.notification_prefs where user_id = uid;
  end if;
  if to_regclass('public.scheduled_notifications') is not null then
    delete from public.scheduled_notifications where user_id = uid;
  end if;

  -- Coach (33–36). Proposals first (FK to conversations is ON DELETE SET NULL),
  -- then conversations (cascades linked messages), then any leftover messages
  -- from before conversation_id existed.
  if to_regclass('public.coach_action_proposals') is not null then
    delete from public.coach_action_proposals where user_id = uid;
  end if;
  if to_regclass('public.coach_conversations') is not null then
    delete from public.coach_conversations where user_id = uid;
  end if;
  if to_regclass('public.coach_messages') is not null then
    delete from public.coach_messages where user_id = uid;
  end if;

  delete from public.user_profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_grind_data() from public;
grant execute on function public.delete_my_grind_data() to authenticated;

commit;
