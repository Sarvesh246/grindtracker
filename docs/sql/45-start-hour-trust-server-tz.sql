-- Phase 45: prefer a stored, verified timezone over the client's claimed hour
-- Idempotent. Apply AFTER 44.
--
-- Bug: complete_session(..., p_start_hour) trusted the client-supplied hour
-- first and only fell back to deriving it from notification_prefs.timezone
-- when the client omitted it. Unlike p_local_date (clamped to within a day
-- of real UTC via grind_safe_local_date), p_start_hour had no correlation
-- check against real time at all — any integer 0-23 was accepted outright.
-- A user could send p_start_hour=3 on an afternoon workout to self-award
-- early_bird, or 23 to self-award night_owl.
--
-- There is no timezone-agnostic clamp for an hour the way +-1 day works for
-- a date (every hour 0-23 is "now" in some real IANA timezone at any given
-- moment), so this can't be closed the same way p_local_date is. What CAN
-- be closed: for any user who has a timezone on record (set once push
-- notifications are configured, in notification_prefs.timezone), we already
-- have a real, server-set instant (sessions.started_at, from the DEFAULT
-- now() at session creation) plus a stored IANA timezone — that's enough to
-- compute the true local hour ourselves, so there's no reason to prefer the
-- client's claim in that case.
--
-- Fix: flip the priority. Try the timezone-derived hour first; only fall
-- back to the client-supplied p_start_hour when no valid timezone is on
-- record at all (the same "we genuinely cannot verify this" case the old
-- code always accepted). This closes the trivial exploit (calling the
-- documented RPC with a fabricated argument) for every user who has ever
-- configured notification timezone/push, without requiring a schema change
-- or breaking the fallback for users who haven't.
--
-- Note: sessions.started_at itself has a client UPDATE grant (day_type,
-- started_at, note — see 11-server-side-xp.sql) for an unrelated feature, so
-- this is a materially higher bar than the old "just pass a bad RPC
-- argument" exploit, not a perfect one against a caller willing to also
-- forge started_at via raw REST. Treated as an acceptable, deliberate
-- trade-off — see docs/sql/45 changelog.

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

  -- Server-verified timezone first: a real UTC instant (sessions.started_at)
  -- converted through a stored IANA timezone beats a bare client-claimed
  -- hour we cannot check at all. Only fall back to the client's hour when no
  -- verified timezone is on record.
  if to_regclass('public.notification_prefs') is not null then
    select extract(hour from (s.started_at at time zone np.timezone))::int
      into v_start_hour
      from sessions s
      join notification_prefs np on np.user_id = s.user_id
     where s.id = p_session_id
       and np.timezone is not null
       and exists (select 1 from pg_timezone_names t where t.name = np.timezone);
  end if;

  if v_start_hour is null and p_start_hour is not null and p_start_hour between 0 and 23 then
    v_start_hour := p_start_hour;
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
