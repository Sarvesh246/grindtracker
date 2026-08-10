-- Phase 29: list every PR set on workout complete (not one-per-exercise).
-- Idempotent: safe to re-run. Apply after 28-web-push-hardening.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- `complete_session()`'s `pr_exercises` payload fed the completion modal's
-- PERSONAL RECORDS list. Migration 20 aggregated with:
--   max(weight), max(reps) GROUP BY exercise_id
-- which (a) collapsed every PR set for an exercise into a single row — so a
-- session with 3 PR sets across 2 exercises only showed 2 cards, and the
-- modal's "PRs" counter (pr_count = set count) no longer matched the list —
-- and (b) could invent a weight×reps pair that never happened (heaviest
-- weight + highest reps from different sets).
--
-- THE FIX
-- -------
-- Return one JSON object per is_pr set, with that set's own weight and reps,
-- ordered by volume desc. `pr_count` stays the set count and now matches the
-- list length. Exercise name falls back to 'Exercise' if the catalog row is
-- gone (LEFT JOIN) so a swapped/deleted exercise never drops a PR from the
-- celebration list.

begin;

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

  if not grind_session_has_working_set(p_session_id) then
    raise exception 'NO_WORKING_SETS: log at least one set before finishing'
      using errcode = '22023';
  end if;

  select coalesce(xp_total, 0), coalesce(level, 1)
    into v_prev_xp, v_prev_lvl
    from user_stats where user_id = v_user;

  perform set_config('grind.allow_session_complete', '1', true);

  update sessions
     set completed_at = now(),
         local_date   = v_date,
         note         = coalesce(p_note, note)
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

revoke all on function complete_session(uuid, date, text) from public, anon;
grant execute on function complete_session(uuid, date, text) to authenticated;

commit;
