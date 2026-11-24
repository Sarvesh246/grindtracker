-- 83-past-edit-keeps-watch-data.sql
--
-- Editing a finished workout in Log → Past (or through the Coach) rewrote it as
-- if it had been typed in by hand:
--   1. started_at / completed_at were reset to a noon-to-one placeholder, so the
--      workout no longer overlapped its Garmin activity (the 80% match needs
--      real times) and its real start hour was lost;
--   2. every session_logs row was deleted and re-inserted, which dropped the
--      watch's per-set heart rate (hr_peak / hr_end / hr_rest_drop_60), rest
--      seconds and entered weight/unit, relabelled the sets source = 'web', and
--      gave them new ids, so a watch retry (keyed by set id) could no longer
--      find them.
--
-- upsert_past_session keeps its signature and its "replace the set list"
-- contract. What changes is what survives a replace:
--   * the session's real start and finish are kept; if the date was moved they
--     shift by the same whole number of days, so the time of day is preserved;
--   * a set that is still in the list (same exercise and set number) keeps its
--     id, timestamps, source, rest and heart-rate numbers. Its entered weight
--     and unit are kept only while the weight itself is unchanged;
--   * sets that are new, and everything on a session that never had real times
--     (a past workout typed in by hand), behave exactly as before.
--
-- Apply after 82. Idempotent (create or replace). Signature unchanged.

begin;

create or replace function upsert_past_session(
  p_day_type   text,
  p_local_date date,
  p_logs       json,
  p_session_id uuid default null,
  p_note       text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_date     date := grind_safe_past_date(p_local_date);
  v_session  uuid;
  v_log      json;
  v_working  int := 0;
  v_row      user_stats%rowtype;
  v_xp       int := 0;
  v_editing  boolean := p_session_id is not null;
  v_skipped  boolean;
  v_rpe      smallint;
  v_old_date date;
  v_shift    int := 0;
  v_old      jsonb := '[]'::jsonb;
  v_prev     jsonb;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_day_type is null or length(btrim(p_day_type)) = 0 then
    raise exception 'DAY_TYPE_REQUIRED' using errcode = '22023';
  end if;

  if p_logs is null or json_typeof(p_logs) <> 'array' then
    raise exception 'LOGS_REQUIRED' using errcode = '22023';
  end if;

  select count(*)::int into v_working
    from json_array_elements(p_logs) e
   where coalesce((e->>'is_skipped')::boolean, false) = false
     and coalesce((e->>'is_warmup')::boolean, false) = false
     and (e->>'weight') is not null
     and (e->>'reps') is not null
     and (e->>'weight') <> ''
     and (e->>'reps') <> '';

  if v_working < 1 then
    raise exception 'NO_WORKING_SETS: log at least one set with weight and reps'
      using errcode = '22023';
  end if;

  perform set_config('grind.allow_session_complete', '1', true);

  if v_editing then
    select local_date into v_old_date
      from sessions
     where id = p_session_id and user_id = v_user and completed_at is not null;
    if not found then
      raise exception 'SESSION_NOT_FOUND' using errcode = '42501';
    end if;
    v_session := p_session_id;
  else
    -- Edit-in-place if a completed session already exists for this slot
    -- (enforces uniqueness; "LOG ANYWAY" path should not create duplicates).
    select id, local_date into v_session, v_old_date
      from sessions
     where user_id = v_user
       and day_type = p_day_type
       and local_date = v_date
       and completed_at is not null
     limit 1;
  end if;

  if v_session is not null then
    -- Keep the real start and finish. A session without a local_date is old
    -- enough that only the placeholder is available.
    v_shift := case when v_old_date is null then 0 else v_date - v_old_date end;

    update sessions
       set day_type     = p_day_type,
           local_date   = v_date,
           started_at   = case when started_at is null
                               then (v_date::text || 'T12:00:00')::timestamptz
                               else started_at + make_interval(days => v_shift) end,
           completed_at = case when started_at is null
                               then (v_date::text || 'T13:00:00')::timestamptz
                               else completed_at + make_interval(days => v_shift) end,
           note         = coalesce(p_note, note)
     where id = v_session;

    select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) into v_old
      from session_logs l
     where l.session_id = v_session;
    delete from session_logs where session_id = v_session;
  else
    insert into sessions (
      user_id, day_type, started_at, completed_at, local_date, xp_earned, note
    ) values (
      v_user,
      p_day_type,
      (v_date::text || 'T12:00:00')::timestamptz,
      (v_date::text || 'T13:00:00')::timestamptz,
      v_date,
      0,
      p_note
    )
    returning id into v_session;
  end if;

  -- Insert payload logs. is_pr is recomputed by grind_recompute_stats.
  for v_log in select * from json_array_elements(p_logs)
  loop
    if (v_log->>'exercise_id') is null or (v_log->>'set_number') is null then
      raise exception 'INVALID_LOG_ROW' using errcode = '22023';
    end if;

    v_skipped := coalesce((v_log->>'is_skipped')::boolean, false);

    -- The row this set replaces, if the session already had one in this slot.
    select o into v_prev
      from jsonb_array_elements(v_old) o
     where o->>'exercise_id' = v_log->>'exercise_id'
       and (o->>'set_number')::int = (v_log->>'set_number')::int
     limit 1;

    v_rpe := null;
    if (v_log->>'rpe') is not null and (v_log->>'rpe') <> '' then
      begin
        v_rpe := (v_log->>'rpe')::smallint;
        if v_rpe < 1 or v_rpe > 10 then
          v_rpe := null;
        end if;
      exception when others then
        v_rpe := null;
      end;
    end if;

    if v_skipped then
      insert into session_logs (
        id, session_id, exercise_id, set_number, weight, reps,
        is_pr, is_warmup, note, is_skipped, rpe, created_at
      ) values (
        coalesce((v_prev->>'id')::uuid, gen_random_uuid()),
        v_session,
        (v_log->>'exercise_id')::uuid,
        (v_log->>'set_number')::int,
        null,
        null,
        false,
        false,
        nullif(v_log->>'note', ''),
        true,
        null,
        coalesce((v_prev->>'created_at')::timestamptz, now())
      );
      continue;
    end if;

    if (v_log->>'weight') is null or (v_log->>'weight') = ''
       or (v_log->>'reps') is null or (v_log->>'reps') = '' then
      continue;
    end if;

    insert into session_logs (
      id, session_id, exercise_id, set_number, weight, reps,
      is_pr, is_warmup, note, is_skipped, rpe,
      created_at, performed_at, source, rest_seconds,
      hr_peak, hr_end, hr_rest_drop_60, entered_weight, entered_unit
    ) values (
      coalesce((v_prev->>'id')::uuid, gen_random_uuid()),
      v_session,
      (v_log->>'exercise_id')::uuid,
      (v_log->>'set_number')::int,
      (v_log->>'weight')::numeric,
      (v_log->>'reps')::int,
      false,
      coalesce((v_log->>'is_warmup')::boolean, false),
      nullif(v_log->>'note', ''),
      false,
      v_rpe,
      coalesce((v_prev->>'created_at')::timestamptz, now()),
      (v_prev->>'performed_at')::timestamptz,
      coalesce(v_prev->>'source', 'web'),
      (v_prev->>'rest_seconds')::int,
      (v_prev->>'hr_peak')::smallint,
      (v_prev->>'hr_end')::smallint,
      (v_prev->>'hr_rest_drop_60')::smallint,
      -- What the user typed on the watch is only still true for the same weight.
      case when (v_prev->>'weight')::numeric is not distinct from (v_log->>'weight')::numeric
           then (v_prev->>'entered_weight')::numeric end,
      case when (v_prev->>'weight')::numeric is not distinct from (v_log->>'weight')::numeric
           then v_prev->>'entered_unit' end
    );
  end loop;

  if not grind_session_has_working_set(v_session) then
    raise exception 'NO_WORKING_SETS' using errcode = '22023';
  end if;

  perform grind_recompute_stats(v_user, grind_safe_local_date(null));

  select * into v_row from user_stats where user_id = v_user;
  select xp_earned into v_xp from sessions where id = v_session;

  return json_build_object(
    'session_id',     v_session,
    'xp_earned',      v_xp,
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak,
    'last_workout_date', v_row.last_workout_date,
    'total_workouts', v_row.total_workouts,
    'pr_count',       (select count(*) from session_logs
                        where session_id = v_session and is_pr = true),
    'is_edit',        v_editing
  );
end;
$$;

revoke all on function upsert_past_session(text, date, json, uuid, text) from public, anon;
grant execute on function upsert_past_session(text, date, json, uuid, text) to authenticated;

commit;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('83-past-edit-keeps-watch-data') on conflict (version) do nothing;
