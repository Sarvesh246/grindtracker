-- Preserve the time of a logged set independently from its insertion time.
alter table public.session_logs add column if not exists performed_at timestamptz;

create or replace function public.grind_preserve_performed_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.weight is not null and old.reps is not null
      and not coalesce(old.is_skipped, false) then
    new.performed_at := coalesce(old.performed_at, old.created_at);
  elsif new.performed_at is not null then
    new.performed_at := least(new.performed_at, now());
  end if;
  return new;
end;
$$;
drop trigger if exists grind_preserve_performed_at on public.session_logs;
create trigger grind_preserve_performed_at before insert or update on public.session_logs
  for each row execute function public.grind_preserve_performed_at();

create or replace function public.grind_last_working_set_at(p_session_id uuid)
returns timestamptz language sql stable set search_path = ''
as $$
  select max(coalesce(performed_at, created_at))
  from public.session_logs
  where session_id = p_session_id and not coalesce(is_warmup, false)
    and not coalesce(is_skipped, false) and weight is not null and reps is not null;
$$;
revoke all on function public.grind_last_working_set_at(uuid) from public, anon, authenticated;

-- Direct log writes also acquire the parent lock. Finish and discard see
-- an entire write, and a concurrent edit can never slip in after completion.
create or replace function public.grind_guard_completed_session_logs()
returns trigger language plpgsql set search_path = ''
as $$
declare
  v_sid uuid;
  v_done timestamptz;
begin
  if current_user not in ('authenticated', 'anon') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and new.session_id is distinct from old.session_id then
    raise exception 'SESSION_LOG_MOVE_FORBIDDEN' using errcode = '42501';
  end if;
  v_sid := case when tg_op = 'DELETE' then old.session_id else new.session_id end;
  select completed_at into v_done from public.sessions
    where id = v_sid and user_id = auth.uid() for update;
  if not found or v_done is not null then
    raise exception 'SESSION_LOGS_NOT_OPEN' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.grind_training_date(
  p_owner uuid, p_instant timestamptz, p_offset_seconds integer, p_fallback date
)
returns date language sql stable set search_path = ''
as $$
  select coalesce(
    (p_instant at time zone (select z.name from public.notification_prefs n
      join pg_catalog.pg_timezone_names z on z.name = n.timezone
      where n.user_id = p_owner))::date,
    (p_instant at time zone (select name from pg_catalog.pg_timezone_names
      where name = current_setting('grind.workout_timezone', true)))::date,
    ((p_instant at time zone 'UTC') + make_interval(secs => p_offset_seconds))::date,
    p_fallback
  );
$$;
revoke all on function public.grind_training_date(uuid, timestamptz, integer, date)
  from public, anon, authenticated;

create or replace function public.discard_open_workout(p_owner uuid, p_session_id uuid)
returns boolean language plpgsql security invoker set search_path = ''
as $$
declare
  v_completed timestamptz;
begin
  if p_owner is null or auth.uid() is distinct from p_owner then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select completed_at into v_completed from public.sessions
    where id = p_session_id and user_id = p_owner for update;
  if not found then return true; end if;
  if v_completed is not null then
    raise exception 'SESSION_ALREADY_COMPLETED' using errcode = '55000';
  end if;
  delete from public.sessions where id = p_session_id and user_id = p_owner and completed_at is null;
  return found;
end;
$$;
revoke all on function public.discard_open_workout(uuid, uuid) from public, anon;
grant execute on function public.discard_open_workout(uuid, uuid) to authenticated;

create or replace function public.materialize_workout_draft(
  p_owner uuid, p_session_id uuid, p_day text, p_started_at timestamptz
)
returns boolean language plpgsql security invoker set search_path = ''
as $$
begin
  if p_owner is null or auth.uid() is distinct from p_owner then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if not exists (select 1 from public.exercises where user_id = p_owner and day_type = p_day) then
    raise exception 'UNKNOWN_WORKOUT_DAY' using errcode = '22023';
  end if;
  insert into public.sessions (id, user_id, day_type, started_at)
    values (p_session_id, p_owner, p_day, least(p_started_at, now()))
    on conflict (id) do nothing;
  return exists (select 1 from public.sessions
    where id = p_session_id and user_id = p_owner and day_type = p_day);
end;
$$;
revoke all on function public.materialize_workout_draft(uuid, uuid, text, timestamptz) from public, anon;
grant execute on function public.materialize_workout_draft(uuid, uuid, text, timestamptz) to authenticated;

create schema if not exists grind_private;
create table if not exists grind_private.workout_finish_receipts (
  session_id uuid not null references public.sessions(id) on delete cascade,
  intent_id uuid not null,
  result json not null,
  primary key (session_id, intent_id)
);

create or replace function public.finish_workout_intent(
  p_owner uuid, p_session_id uuid, p_intent_id uuid, p_local_date date,
  p_note text, p_start_hour integer, p_offset_minutes integer, p_timezone text
)
returns json language plpgsql security definer set search_path = ''
as $$
declare
  v_result json;
  v_completed timestamptz;
begin
  if p_owner is null or auth.uid() is distinct from p_owner then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  select completed_at into v_completed from public.sessions
    where id = p_session_id and user_id = p_owner for update;
  if not found then raise exception 'SESSION_NOT_OPEN' using errcode = '42501'; end if;
  select result into v_result from grind_private.workout_finish_receipts
    where session_id = p_session_id and intent_id = p_intent_id;
  if found then return v_result; end if;
  if v_completed is not null then
    raise exception 'SESSION_ALREADY_COMPLETED' using errcode = '55000';
  end if;
  perform set_config('grind.workout_timezone', coalesce(p_timezone, ''), true);
  v_result := public.complete_session(p_session_id, p_local_date, p_note, p_start_hour, p_offset_minutes);
  insert into grind_private.workout_finish_receipts values (p_session_id, p_intent_id, v_result);
  return v_result;
end;
$$;
revoke all on function public.finish_workout_intent(uuid, uuid, uuid, date, text, integer, integer, text) from public, anon;
grant execute on function public.finish_workout_intent(uuid, uuid, uuid, date, text, integer, integer, text) to authenticated;


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
   where id = p_session_id and user_id = v_user and completed_at is null for update;
  if not found then
    raise exception 'SESSION_NOT_OPEN: not found, not yours, or already completed'
      using errcode = '42501';
  end if;

  if not grind_session_has_working_set(p_session_id) then
    raise exception 'NO_WORKING_SETS: log at least one set before finishing'
      using errcode = '22023';
  end if;

  v_last_set := public.grind_last_working_set_at(p_session_id);

  -- Server-verified timezone first: a real UTC instant converted through a
  -- stored IANA timezone beats anything the client claims. Only fall back to
  -- the client's hour / offset when no verified timezone is on record.
  if to_regclass('public.notification_prefs') is not null then
    select extract(hour from (v_started at time zone np.timezone))::int
      into v_start_hour
      from notification_prefs np
     where np.user_id = v_user
       and np.timezone is not null
       and exists (select 1 from pg_timezone_names t where t.name = np.timezone);
  end if;

  if v_start_hour is null and p_start_hour is not null and p_start_hour between 0 and 23 then
    v_start_hour := p_start_hour;
  end if;

  v_date := public.grind_training_date(v_user, v_last_set,
    case when p_utc_offset_minutes between -840 and 840 then p_utc_offset_minutes * 60 end, v_today);

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

create or replace function public.watch_sync_session(p_user uuid, p_session jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid          uuid := (p_session->>'id')::uuid;
  v_offset       int  := (p_session->>'utc_offset_seconds')::int;
  v_started      timestamptz := (p_session->>'started_at')::timestamptz;
  -- Not least(ended_at, now()): LEAST ignores nulls, so an open session
  -- (no ended_at) would come back as finished "now".
  v_ended        timestamptz := case when p_session->>'ended_at' is null then null
                                     else least((p_session->>'ended_at')::timestamptz, now()) end;
  v_workout      text := nullif(btrim(p_session->>'workout_id'), '');
  v_sess         public.sessions%rowtype;
  v_existed      boolean;
  v_was_done     boolean;
  v_day          text;
  v_today        date;
  v_set          jsonb;
  v_set_id       uuid;
  v_log          public.session_logs%rowtype;
  v_accepted     uuid[] := '{}';
  v_updated      uuid[] := '{}';
  v_duplicate    uuid[] := '{}';
  v_rejected     jsonb := '[]'::jsonb;
  v_completed_now boolean := false;
  v_new_badges   json := '[]'::json;
  v_stats        public.user_stats%rowtype;
begin
  if p_user is null or v_sid is null or v_started is null then
    raise exception 'WATCH_INVALID_PAYLOAD' using errcode = '22023';
  end if;

  -- Serialize concurrent uploads of the same session (a retry racing the
  -- original). Row locks can't cover a row that doesn't exist yet.
  perform pg_advisory_xact_lock(hashtextextended('watch_session:' || v_sid::text, 0));

  -- Same escape hatch complete_session / upsert_past_session use: lets this
  -- definer write completion fields and logs on a completed session.
  perform set_config('grind.allow_session_complete', '1', true);

  select * into v_sess from public.sessions where id = v_sid for update;
  v_existed := found;

  if v_existed and v_sess.user_id is distinct from p_user then
    raise exception 'WATCH_SESSION_ID_CONFLICT' using errcode = '42501';
  end if;

  if v_existed then
    v_day := v_sess.day_type;
    v_was_done := v_sess.completed_at is not null;
  else
    v_was_done := false;
    if v_workout is not null then
      select e.day_type into v_day
        from public.exercises e
       where e.user_id = p_user and e.day_type = v_workout
       limit 1;
      if v_day is null then
        raise exception 'WATCH_UNKNOWN_WORKOUT' using errcode = '22023';
      end if;
    else
      -- No workout id: take the day of the first set's (owned) exercise.
      select e.day_type into v_day
        from jsonb_array_elements(coalesce(p_session->'sets', '[]'::jsonb)) with ordinality s(v, n)
        join public.exercises e
          on e.id = (s.v->>'exercise_id')::uuid and e.user_id = p_user
       order by s.n
       limit 1;
      if v_day is null then
        raise exception 'WATCH_WORKOUT_REQUIRED' using errcode = '22023';
      end if;
    end if;

    begin
      -- A session uploaded already finished is inserted finished, so it never
      -- occupies (or collides with) the web app's one-open-per-day slot. The
      -- completion block below still checks it and sets local_date.
      insert into public.sessions (
        id, user_id, day_type, started_at, completed_at, xp_earned, source,
        avg_heart_rate, max_heart_rate, calories
      ) values (
        v_sid, p_user, v_day, v_started,
        case when v_ended is null then null else greatest(v_ended, v_started) end,
        0, 'watch',
        (p_session->>'avg_heart_rate')::smallint,
        (p_session->>'max_heart_rate')::smallint,
        (p_session->>'calories')::int
      )
      returning * into v_sess;
    exception when unique_violation then
      -- sessions_one_open_per_day_idx: the web app has this day open.
      raise exception 'WATCH_OPEN_SESSION_CONFLICT' using errcode = '23505';
    end;
  end if;

  if v_existed then
    update public.sessions
       set avg_heart_rate = coalesce((p_session->>'avg_heart_rate')::smallint, avg_heart_rate),
           max_heart_rate = coalesce((p_session->>'max_heart_rate')::smallint, max_heart_rate),
           calories       = coalesce((p_session->>'calories')::int, calories)
     where id = v_sid;
  end if;

  -- ── Sets ──────────────────────────────────────────────────────────────────
  for v_set in select * from jsonb_array_elements(coalesce(p_session->'sets', '[]'::jsonb))
  loop
    v_set_id := (v_set->>'id')::uuid;
    select * into v_log from public.session_logs where id = v_set_id;

    if found then
      if v_log.session_id is distinct from v_sid then
        v_rejected := v_rejected || jsonb_build_object(
          'id', v_set_id, 'code', 'set_id_conflict',
          'message', 'This set id already belongs to another session.');
      elsif v_log.exercise_id = (v_set->>'exercise_id')::uuid
        and v_log.set_number = (v_set->>'set_number')::int
        and v_log.reps is not distinct from (v_set->>'reps')::int
        and v_log.entered_weight is not distinct from (v_set->>'entered_weight')::numeric
        and v_log.entered_unit is not distinct from (v_set->>'entered_unit')
        and v_log.rest_seconds is not distinct from (v_set->>'rest_seconds')::int
        and v_log.is_warmup = coalesce((v_set->>'is_warmup')::boolean, false) then
        v_duplicate := v_duplicate || v_set_id;
      elsif not exists (select 1 from public.exercises
                         where id = (v_set->>'exercise_id')::uuid and user_id = p_user) then
        v_rejected := v_rejected || jsonb_build_object(
          'id', v_set_id, 'code', 'unknown_exercise',
          'message', 'Exercise not found for this account.');
      else
        begin
          update public.session_logs
             set exercise_id    = (v_set->>'exercise_id')::uuid,
                 set_number     = (v_set->>'set_number')::int,
                 reps           = (v_set->>'reps')::int,
                 weight         = (v_set->>'weight_lbs')::numeric,
                 entered_weight = (v_set->>'entered_weight')::numeric,
                 entered_unit   = v_set->>'entered_unit',
                 rest_seconds   = (v_set->>'rest_seconds')::int,
                 is_warmup      = coalesce((v_set->>'is_warmup')::boolean, false),
                 is_skipped     = false,
                 created_at     = (v_set->>'completed_at')::timestamptz
           where id = v_set_id;
          v_updated := v_updated || v_set_id;
        exception when unique_violation then
          v_rejected := v_rejected || jsonb_build_object(
            'id', v_set_id, 'code', 'set_number_taken',
            'message', 'Another set already uses this exercise and set number.');
        end;
      end if;
      continue;
    end if;

    if not exists (select 1 from public.exercises
                    where id = (v_set->>'exercise_id')::uuid and user_id = p_user) then
      v_rejected := v_rejected || jsonb_build_object(
        'id', v_set_id, 'code', 'unknown_exercise',
        'message', 'Exercise not found for this account.');
      continue;
    end if;

    -- A web skip marker in the same slot gives way to a real set.
    delete from public.session_logs
     where session_id = v_sid
       and exercise_id = (v_set->>'exercise_id')::uuid
       and set_number = (v_set->>'set_number')::int
       and is_skipped = true;

    insert into public.session_logs (
      id, session_id, exercise_id, set_number, weight, reps,
      is_pr, is_warmup, is_skipped, source,
      entered_weight, entered_unit, rest_seconds, created_at
    ) values (
      v_set_id, v_sid, (v_set->>'exercise_id')::uuid, (v_set->>'set_number')::int,
      (v_set->>'weight_lbs')::numeric, (v_set->>'reps')::int,
      false, coalesce((v_set->>'is_warmup')::boolean, false), false, 'watch',
      (v_set->>'entered_weight')::numeric, v_set->>'entered_unit',
      (v_set->>'rest_seconds')::int, (v_set->>'completed_at')::timestamptz
    )
    on conflict (session_id, exercise_id, set_number) do nothing;

    if found then
      v_accepted := v_accepted || v_set_id;
    else
      v_rejected := v_rejected || jsonb_build_object(
        'id', v_set_id, 'code', 'set_number_taken',
        'message', 'Another set already uses this exercise and set number.');
    end if;
  end loop;

  -- ── Completion ───────────────────────────────────────────────────────────
  v_today := grind_safe_local_date(grind_watch_local_date(p_user, now(), v_offset));

  if v_ended is not null and not v_was_done then
    if not grind_session_has_working_set(v_sid) then
      raise exception 'WATCH_NO_WORKING_SETS' using errcode = '22023';
    end if;
    begin
      update public.sessions
         set completed_at = greatest(v_ended, started_at),
             -- The last working set determines the training day.
             local_date   = least(v_today, greatest((v_started at time zone 'UTC')::date - 1,
               public.grind_training_date(p_user, public.grind_last_working_set_at(v_sid),
                 v_offset, grind_watch_local_date(p_user, v_ended, v_offset)))),
             start_hour   = extract(hour from
               case when v_offset is not null
                 then (started_at at time zone 'utc') + make_interval(secs => v_offset)
                 else (started_at at time zone coalesce(
                   (select np.timezone from public.notification_prefs np
                     where np.user_id = p_user
                       and exists (select 1 from pg_timezone_names t where t.name = np.timezone)),
                   'UTC'))
               end)::smallint
       where id = v_sid;
    exception when unique_violation then
      -- sessions_one_completed_per_day_idx: this day is already logged that date.
      raise exception 'WATCH_DAY_ALREADY_LOGGED' using errcode = '23505';
    end;
    v_completed_now := true;
  end if;

  -- Stats are derived, never written: recompute whenever a completed session
  -- changed (new completion, or late sets for an already-finished workout).
  if v_completed_now
     or (v_was_done and (cardinality(v_accepted) > 0 or cardinality(v_updated) > 0)) then
    perform grind_recompute_stats(p_user, v_today);
  end if;
  if v_completed_now then
    v_new_badges := grind_award_badges_for(p_user);
  end if;

  select * into v_sess from public.sessions where id = v_sid;
  select * into v_stats from public.user_stats where user_id = p_user;

  return json_build_object(
    'session', json_build_object(
      'id',            v_sess.id,
      'workout_id',    v_sess.day_type,
      'status',        case when v_sess.completed_at is null then 'open' else 'completed' end,
      'created',       not v_existed,
      'completed_now', v_completed_now,
      'started_at',    v_sess.started_at,
      'completed_at',  v_sess.completed_at,
      'local_date',    v_sess.local_date,
      'xp_earned',     v_sess.xp_earned
    ),
    'sets', json_build_object(
      'accepted',  to_json(v_accepted),
      'updated',   to_json(v_updated),
      'duplicate', to_json(v_duplicate),
      'rejected',  v_rejected
    ),
    'stats', case when v_sess.completed_at is null then null else json_build_object(
      'xp_total',       v_stats.xp_total,
      'level',          v_stats.level,
      'current_streak', v_stats.current_streak,
      'pr_count',       (select count(*) from public.session_logs
                          where session_id = v_sid and is_pr = true)
    ) end,
    'new_badges', v_new_badges
  );
end;
$$;

revoke all on function public.watch_sync_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_sync_session(uuid, jsonb) to service_role;

insert into public.grind_migrations (version) values ('76-workout-commands') on conflict (version) do nothing;
