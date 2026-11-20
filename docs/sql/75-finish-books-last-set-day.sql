-- 75: a workout counts on the day it was lifted, not the day it was saved.
--
-- A workout left open (no Finish tapped) and saved days later from the Log
-- day picker was booked to the day of the save: complete_session stamped
-- local_date with the client's "today". Twice in one week a Push lifted one
-- evening landed on a later day, so the calendar showed a rest day where the
-- lift was and two workouts on the save day, and streaks were computed from
-- the wrong dates.
--
-- complete_session now books local_date to the local day of the session's
-- LAST logged set. The local day comes from the verified IANA timezone in
-- notification_prefs when there is one, else from p_utc_offset_minutes (the
-- device's offset, which the app now sends), else, for a client that sends
-- neither, the old behavior (the client's today). The result is clamped to
-- [UTC day the session started - 1, the client's today], so it can never
-- move a workout outside its own session or into the future.
--
-- p_local_date keeps its meaning: the user's today, which is what
-- grind_recompute_stats measures the current streak against. completed_at
-- stays now(), so the 10-minute undo window still works for a late save.
--
-- uncomplete_session recomputed stats "as of" the session's stored date. For
-- a backdated session that is days old, which would judge the streak from the
-- past; it now prefers the client's today.
--
-- Also two hygiene fixes the database linter flagged:
--  * grind_prune_scheduled_notifications was executable by signed-in users in
--    production although 30-notification-edge-fixes.sql grants it only to
--    service_role. Harmless (it only deletes sent/cancelled rows older than
--    14 days, as the cron does), but it should match the repo.
--  * set_user_rotation_updated_at had no pinned search_path.
--
-- Idempotent. Apply before deploying the client that sends
-- p_utc_offset_minutes: the 4-argument function is dropped, and a client
-- calling with 4 named arguments still resolves to the new one.

drop function if exists public.complete_session(uuid, date, text, integer);

create or replace function public.complete_session(
  p_session_id          uuid,
  p_local_date          date    default null,
  p_note                text    default null,
  p_start_hour          integer default null,
  p_utc_offset_minutes  integer default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user       uuid := auth.uid();
  v_today      date := grind_safe_local_date(p_local_date);
  v_date       date := null;
  v_started    timestamptz;
  v_last_set   timestamptz;
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

  select started_at into v_started
    from sessions
   where id = p_session_id and user_id = v_user and completed_at is null;
  if not found then
    raise exception 'SESSION_NOT_OPEN: not found, not yours, or already completed'
      using errcode = '42501';
  end if;

  if not grind_session_has_working_set(p_session_id) then
    raise exception 'NO_WORKING_SETS: log at least one set before finishing'
      using errcode = '22023';
  end if;

  select max(created_at) into v_last_set
    from session_logs where session_id = p_session_id;

  -- Server-verified timezone first: a real UTC instant converted through a
  -- stored IANA timezone beats anything the client claims. Only fall back to
  -- the client's hour / offset when no verified timezone is on record.
  if to_regclass('public.notification_prefs') is not null then
    select extract(hour from (v_started at time zone np.timezone))::int,
           (v_last_set at time zone np.timezone)::date
      into v_start_hour, v_date
      from notification_prefs np
     where np.user_id = v_user
       and np.timezone is not null
       and exists (select 1 from pg_timezone_names t where t.name = np.timezone);
  end if;

  if v_start_hour is null and p_start_hour is not null and p_start_hour between 0 and 23 then
    v_start_hour := p_start_hour;
  end if;

  if v_date is null and v_last_set is not null
     and p_utc_offset_minutes is not null and p_utc_offset_minutes between -840 and 840 then
    v_date := ((v_last_set at time zone 'utc') + make_interval(mins => p_utc_offset_minutes))::date;
  end if;

  v_date := least(
    greatest(coalesce(v_date, v_today), (v_started at time zone 'utc')::date - 1),
    v_today
  );

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

  perform grind_recompute_stats(v_user, v_today);

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
    'local_date',     v_date,
    'pr_count',       (select count(*) from session_logs
                        where session_id = p_session_id and is_pr = true),
    'pr_exercises',   v_prs
  );
end;
$$;

revoke all on function public.complete_session(uuid, date, text, integer, integer) from public, anon;
grant execute on function public.complete_session(uuid, date, text, integer, integer) to authenticated;

create or replace function public.uncomplete_session(p_session_id uuid, p_local_date date default null)
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

  -- The user's today, not the session's own (possibly earlier) day.
  perform grind_recompute_stats(
    v_user,
    grind_safe_local_date(coalesce(p_local_date, v_stored_date))
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

-- Linter hygiene.
revoke all on function public.grind_prune_scheduled_notifications() from public, anon, authenticated;
grant execute on function public.grind_prune_scheduled_notifications() to service_role;

alter function public.set_user_rotation_updated_at() set search_path = public;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('75-finish-books-last-set-day') on conflict (version) do nothing;
