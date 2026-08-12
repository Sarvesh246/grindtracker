-- Phase 37: Coach weight corrections that preserve skip markers + RPE
-- Idempotent: safe to re-run.
--
-- correct_weights previously rewrote whole sessions via upsert_past_session,
-- which drops is_skipped marker rows and never round-trips rpe. This RPC
-- updates matching working-set weights in place, then recomputes stats.

create or replace function coach_correct_session_weights(
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
  v_date    date := grind_safe_local_date(p_local_date);
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

  -- Recompute XP / PRs / is_pr from the corrected weights.
  perform grind_recompute_stats(v_user, v_date);

  return json_build_object(
    'updated_sets', v_updated,
    'session_id', p_session_id
  );
end;
$$;

revoke all on function coach_correct_session_weights(uuid, uuid, numeric, numeric, date)
  from public, anon;
grant execute on function coach_correct_session_weights(uuid, uuid, numeric, numeric, date)
  to authenticated;
