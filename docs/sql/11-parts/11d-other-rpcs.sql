-- Part 4 of 5 of 11-server-side-xp.sql
-- uncomplete_session(), delete_session(), refresh_stats() + grants
--
-- The full migration is one ~21KB file, which the Supabase SQL editor
-- truncates mid-function. These parts are split at safe statement
-- boundaries. Run them IN ORDER, each on its own. Every part is
-- idempotent, so re-running one is harmless.
--
-- Part 5 is the one that REVOKES client stat writes — it breaks the old
-- deployed client, so run it immediately before deploying the new code.

begin;

/**
 * Reverse a completion (the 10-minute undo banner). Reopens the session and
 * lets the recompute walk the stats back — no stored "previous value" needed,
 * so an undo can never restore a number the logs don't justify.
 */
create or replace function uncomplete_session(
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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not exists (
    select 1 from sessions
     where id = p_session_id and user_id = v_user and completed_at is not null
  ) then
    raise exception 'SESSION_NOT_COMPLETED: not found, not yours, or already open'
      using errcode = '42501';
  end if;

  update sessions
     set completed_at = null, xp_earned = 0, local_date = null
   where id = p_session_id;

  perform grind_recompute_stats(v_user, grind_safe_local_date(p_local_date));

  select * into v_row from user_stats where user_id = v_user;
  return json_build_object(
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'total_workouts', v_row.total_workouts
  );
end;
$$;

/**
 * Delete a logged workout (the past-workout screen) and settle up.
 */
create or replace function delete_session(
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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  delete from sessions where id = p_session_id and user_id = v_user;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = '42501';
  end if;

  perform grind_recompute_stats(v_user, grind_safe_local_date(p_local_date));

  select * into v_row from user_stats where user_id = v_user;
  return json_build_object(
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'total_workouts', v_row.total_workouts
  );
end;
$$;

/**
 * Settle stats without changing a session. Two callers:
 *   - the home page, to lapse a stale streak in the user's own timezone
 *   - the past-workout screen, after inserting/editing a backdated session
 */
create or replace function refresh_stats(p_local_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  user_stats%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  perform grind_recompute_stats(v_user, grind_safe_local_date(p_local_date));

  select * into v_row from user_stats where user_id = v_user;
  return json_build_object(
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak,
    'total_workouts', v_row.total_workouts,
    'last_workout_date', v_row.last_workout_date
  );
end;
$$;

revoke all on function complete_session(uuid, date, text)   from public, anon;
revoke all on function uncomplete_session(uuid, date)       from public, anon;
revoke all on function delete_session(uuid, date)           from public, anon;
revoke all on function refresh_stats(date)                  from public, anon;
grant execute on function complete_session(uuid, date, text) to authenticated;
grant execute on function uncomplete_session(uuid, date)     to authenticated;
grant execute on function delete_session(uuid, date)         to authenticated;
grant execute on function refresh_stats(date)                to authenticated;

commit;
