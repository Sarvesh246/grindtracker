-- Part 3 of 5 of 11-server-side-xp.sql
-- grind_safe_local_date() + complete_session()
--
-- The full migration is one ~21KB file, which the Supabase SQL editor
-- truncates mid-function. These parts are split at safe statement
-- boundaries. Run them IN ORDER, each on its own. Every part is
-- idempotent, so re-running one is harmless.
--
-- Part 5 is the one that REVOKES client stat writes — it breaks the old
-- deployed client, so run it immediately before deploying the new code.

begin;

-- ── Client-facing RPCs ──────────────────────────────────────────────────────
-- Each one verifies ownership itself, because `security definer` means RLS is
-- not doing it for us.

-- Clamp a client-supplied local date to something physically possible. Real
-- timezones span UTC-12..UTC+14, so ±1 day around UTC covers every legitimate
-- user while stopping someone claiming a date in 2043 to farm streak bonuses.
create or replace function grind_safe_local_date(p_local_date date)
returns date
language sql immutable
set search_path = public
as $$
  select least(
    greatest(coalesce(p_local_date, (now() at time zone 'utc')::date),
             (now() at time zone 'utc')::date - 1),
    (now() at time zone 'utc')::date + 1
  );
$$;

/**
 * Finish an in-progress workout. Returns the numbers the completion modal needs.
 */
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

  -- Ownership + state check in one shot. Completing an already-completed
  -- session would otherwise double-count it.
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

  -- PR exercises for this session, for the modal's "NEW PR" list.
  select coalesce(json_agg(json_build_object('name', e.name, 'weight', x.w)), '[]'::json)
    into v_prs
    from (
      select sl.exercise_id, max(sl.weight) as w
        from session_logs sl
       where sl.session_id = p_session_id and sl.is_pr = true
       group by sl.exercise_id
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
    -- Count of PR *sets* (drives XP and the modal's counter); pr_exercises is
    -- deduplicated per exercise for the "NEW PR" list.
    'pr_count',       (select count(*) from session_logs
                        where session_id = p_session_id and is_pr = true),
    'pr_exercises',   v_prs
  );
end;
$$;

commit;
