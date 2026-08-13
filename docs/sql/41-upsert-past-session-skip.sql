-- 41-upsert-past-session-skip.sql
--
-- Past-workout edits must round-trip warm-ups, skip markers, per-set notes, and RPE.
-- upsert_past_session (20) already accepted is_warmup + note in p_logs JSON, but:
--   1. Empty weight/reps rows were dropped, so is_skipped markers never persisted
--   2. is_skipped was hardcoded false on insert
--   3. The early working-set count treated warm-ups as working sets
--   4. RPE (migration 31) was dropped on every past save (delete+reinsert without rpe)
--
-- Apply after 40. Idempotent (create or replace). Signature unchanged.
-- p_logs row shape: {exercise_id, set_number, weight?, reps?, is_warmup?, is_skipped?, note?, rpe?}

begin;

create or replace function upsert_past_session(
  p_day_type   text,
  p_local_date date,
  p_logs       json,          -- [{exercise_id, set_number, weight?, reps?, is_warmup?, is_skipped?, note?, rpe?}]
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

  -- Count real working sets (exclude warm-ups and skip markers).
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
    if not exists (
      select 1 from sessions
       where id = p_session_id and user_id = v_user and completed_at is not null
    ) then
      raise exception 'SESSION_NOT_FOUND' using errcode = '42501';
    end if;
    v_session := p_session_id;
    update sessions
       set day_type = p_day_type,
           local_date = v_date,
           started_at = (v_date::text || 'T12:00:00')::timestamptz,
           completed_at = (v_date::text || 'T13:00:00')::timestamptz,
           note = coalesce(p_note, note)
     where id = v_session;
    delete from session_logs where session_id = v_session;
  else
    -- Edit-in-place if a completed session already exists for this slot
    -- (enforces uniqueness; "LOG ANYWAY" path should not create duplicates).
    select id into v_session
      from sessions
     where user_id = v_user
       and day_type = p_day_type
       and local_date = v_date
       and completed_at is not null
     limit 1;

    if v_session is not null then
      update sessions
         set note = coalesce(p_note, note),
             started_at = (v_date::text || 'T12:00:00')::timestamptz,
             completed_at = (v_date::text || 'T13:00:00')::timestamptz
       where id = v_session;
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
  end if;

  -- Insert payload logs. is_pr is recomputed by grind_recompute_stats.
  for v_log in select * from json_array_elements(p_logs)
  loop
    if (v_log->>'exercise_id') is null or (v_log->>'set_number') is null then
      raise exception 'INVALID_LOG_ROW' using errcode = '22023';
    end if;

    v_skipped := coalesce((v_log->>'is_skipped')::boolean, false);

    -- Preserve RPE on past edits when the client round-trips it (migration 31).
    -- Clamp to 1–10; invalid/missing → null (same as session_logs_rpe_range).
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
      -- Skip marker: weight/reps always null (CHECK on session_logs). RPE must
      -- also be null — a skip isn't a logged set.
      insert into session_logs (
        session_id, exercise_id, set_number, weight, reps,
        is_pr, is_warmup, note, is_skipped, rpe
      ) values (
        v_session,
        (v_log->>'exercise_id')::uuid,
        (v_log->>'set_number')::int,
        null,
        null,
        false,
        false,
        nullif(v_log->>'note', ''),
        true,
        null
      );
      continue;
    end if;

    if (v_log->>'weight') is null or (v_log->>'weight') = ''
       or (v_log->>'reps') is null or (v_log->>'reps') = '' then
      -- Skip empty placeholder rows (client may send the full set grid).
      continue;
    end if;

    insert into session_logs (
      session_id, exercise_id, set_number, weight, reps,
      is_pr, is_warmup, note, is_skipped, rpe
    ) values (
      v_session,
      (v_log->>'exercise_id')::uuid,
      (v_log->>'set_number')::int,
      (v_log->>'weight')::numeric,
      (v_log->>'reps')::int,
      false,
      coalesce((v_log->>'is_warmup')::boolean, false),
      nullif(v_log->>'note', ''),
      false,
      v_rpe
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
    'is_edit',        v_editing or true
  );
end;
$$;

revoke all on function upsert_past_session(text, date, json, uuid, text) from public, anon;
grant execute on function upsert_past_session(text, date, json, uuid, text) to authenticated;

commit;
