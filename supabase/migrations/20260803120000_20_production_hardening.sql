-- Phase 20: production hardening
-- Idempotent. Apply AFTER 01–19.
--
-- Closes the critical/high audit findings:
--   * grind_stats_drift no longer readable by every authenticated user
--   * complete_session requires ≥1 real working set
--   * past workouts go through a transactional RPC (no delete-then-hope)
--   * clients cannot mint completed sessions or write badges directly
--   * one open session per day_type; one completed per (user, local_date, day_type)
--   * undo-completion enforces the 10-minute window server-side
--   * grind_dates_connected is self-only
--   * helpers for best-sets batch fetch + session create/resume

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. grind_stats_drift — admin only
-- ════════════════════════════════════════════════════════════════════════════

create or replace function grind_stats_drift()
returns table (
  user_id uuid, username text,
  stored_xp numeric, derived_xp numeric, xp_delta numeric,
  stored_workouts int, derived_workouts int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not is_grind_admin() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  with runs as (
    select s.user_id, d.d,
           row_number() over (partition by s.user_id, d.d - d.rn order by d.d)::int as streak_day
      from (
        select user_id, local_date as d,
               row_number() over (partition by user_id order by local_date)::int as rn
          from (select distinct user_id, local_date
                  from sessions
                 where completed_at is not null and local_date is not null) q
      ) d
      join (select distinct user_id from sessions) s on s.user_id = d.user_id
  ),
  derived as (
    select s.user_id,
           sum(100
               + 25 * coalesce((select count(*) from session_logs sl
                                 where sl.session_id = s.id and sl.is_pr = true), 0)
               + case when r.streak_day % 7 = 0 then 50 else 0 end) as xp,
           count(*)::int as workouts
      from sessions s
      left join runs r on r.user_id = s.user_id and r.d = s.local_date
     where s.completed_at is not null
     group by s.user_id
  )
  select us.user_id, up.username,
         us.xp_total::numeric, coalesce(d.xp, 0), coalesce(d.xp, 0) - us.xp_total::numeric,
         us.total_workouts, coalesce(d.workouts, 0)
    from user_stats us
    left join derived d on d.user_id = us.user_id
    left join user_profiles up on up.id = us.user_id
   order by abs(coalesce(d.xp, 0) - us.xp_total::numeric) desc;
end;
$$;

revoke all on function grind_stats_drift() from public, anon, authenticated;
grant execute on function grind_stats_drift() to authenticated; -- still callable; body gates on is_grind_admin()

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Working-set predicate + complete_session / uncomplete_session hardening
-- ════════════════════════════════════════════════════════════════════════════

create or replace function grind_session_has_working_set(p_session_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from session_logs sl
     where sl.session_id = p_session_id
       and coalesce(sl.is_skipped, false) = false
       and sl.weight is not null
       and sl.reps is not null
  );
$$;

create or replace function grind_safe_past_date(p_local_date date)
returns date
language sql
immutable
set search_path = public
as $$
  -- Past logging: not future (relative to UTC+1 slack), not older than 2 years.
  select least(
    greatest(
      coalesce(p_local_date, (now() at time zone 'utc')::date - 1),
      (now() at time zone 'utc')::date - 730
    ),
    (now() at time zone 'utc')::date
  );
$$;

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

  update sessions
     set completed_at = now(),
         local_date   = v_date,
         note         = coalesce(p_note, note)
   where id = p_session_id;

  perform grind_recompute_stats(v_user, v_date);

  select * into v_row from user_stats where user_id = v_user;
  select xp_earned into v_xp_earned from sessions where id = p_session_id;

  select coalesce(json_agg(json_build_object(
           'name', e.name, 'weight', x.w, 'reps', x.r
         ) order by x.vol desc), '[]'::json)
    into v_prs
    from (
      select sl.exercise_id,
             max(sl.weight) as w,
             max(sl.reps)   as r,
             max(sl.weight * sl.reps) as vol
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
    'pr_count',       (select count(*) from session_logs
                        where session_id = p_session_id and is_pr = true),
    'pr_exercises',   v_prs
  );
end;
$$;

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

  -- 10-minute undo window — enforced here, not only in the UI.
  if v_completed_at < now() - interval '10 minutes' then
    raise exception 'UNDO_WINDOW_EXPIRED'
      using errcode = '22023';
  end if;

  update sessions
     set completed_at = null, xp_earned = 0, local_date = null
   where id = p_session_id;

  -- Recompute against today's safe date; do NOT accept an arbitrary client date
  -- that could reshuffle streak grouping of older workouts.
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

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Uniqueness + dedupe open / completed sessions
-- ════════════════════════════════════════════════════════════════════════════

-- Keep the newest open session per (user, day_type); drop the rest + logs.
delete from session_logs sl
 using sessions a
 where sl.session_id = a.id
   and a.completed_at is null
   and exists (
     select 1 from sessions b
      where b.user_id = a.user_id
        and b.day_type = a.day_type
        and b.completed_at is null
        and b.started_at > a.started_at
   );

delete from sessions a
 where a.completed_at is null
   and exists (
     select 1 from sessions b
      where b.user_id = a.user_id
        and b.day_type = a.day_type
        and b.completed_at is null
        and b.started_at > a.started_at
   );

-- Keep the highest-xp (else newest) completed session per (user, local_date, day_type).
delete from session_logs sl
 using sessions a
 where sl.session_id = a.id
   and a.completed_at is not null
   and a.local_date is not null
   and exists (
     select 1 from sessions b
      where b.user_id = a.user_id
        and b.day_type = a.day_type
        and b.local_date = a.local_date
        and b.completed_at is not null
        and (
          coalesce(b.xp_earned, 0) > coalesce(a.xp_earned, 0)
          or (coalesce(b.xp_earned, 0) = coalesce(a.xp_earned, 0)
              and b.completed_at > a.completed_at)
        )
   );

delete from sessions a
 where a.completed_at is not null
   and a.local_date is not null
   and exists (
     select 1 from sessions b
      where b.user_id = a.user_id
        and b.day_type = a.day_type
        and b.local_date = a.local_date
        and b.completed_at is not null
        and (
          coalesce(b.xp_earned, 0) > coalesce(a.xp_earned, 0)
          or (coalesce(b.xp_earned, 0) = coalesce(a.xp_earned, 0)
              and b.completed_at > a.completed_at)
        )
   );

create unique index if not exists sessions_one_open_per_day_idx
  on sessions (user_id, day_type)
  where completed_at is null;

create unique index if not exists sessions_one_completed_per_day_idx
  on sessions (user_id, local_date, day_type)
  where completed_at is not null and local_date is not null;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Guard: clients may only insert OPEN sessions
-- ════════════════════════════════════════════════════════════════════════════

-- Existing FOR ALL / insert policies vary by env; add a restrictive check
-- via trigger that still lets security-definer RPCs through when they flip the
-- session GUC (set_config with is_local=true rolls back with the txn).

create or replace function grind_guard_session_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- SECURITY DEFINER RPCs run as their owner, so current_user <> session_user.
  -- Direct PostgREST callers keep both equal to the invoker role — that's who
  -- we gate. Also honor an explicit transaction-local allow flag.
  if current_user is distinct from session_user
     or current_setting('grind.allow_session_complete', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.completed_at is not null
       or new.xp_earned is distinct from 0
       or new.local_date is not null then
      raise exception 'COMPLETED_SESSION_DIRECT_INSERT_FORBIDDEN'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if (old.completed_at is distinct from new.completed_at)
       or (old.xp_earned is distinct from new.xp_earned)
       or (old.local_date is distinct from new.local_date) then
      raise exception 'SESSION_COMPLETION_FIELDS_FORBIDDEN'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists grind_guard_session_write on sessions;
create trigger grind_guard_session_write
  before insert or update on sessions
  for each row execute function grind_guard_session_write();

-- complete_session must set the GUC before updating completion fields.
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

  select coalesce(json_agg(json_build_object(
           'name', e.name, 'weight', x.w, 'reps', x.r
         ) order by x.vol desc), '[]'::json)
    into v_prs
    from (
      select sl.exercise_id,
             max(sl.weight) as w,
             max(sl.reps)   as r,
             max(sl.weight * sl.reps) as vol
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
    'pr_count',       (select count(*) from session_logs
                        where session_id = p_session_id and is_pr = true),
    'pr_exercises',   v_prs
  );
end;
$$;

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
     set completed_at = null, xp_earned = 0, local_date = null
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

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Atomic past-session upsert (create or replace logs + recompute)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function upsert_past_session(
  p_day_type   text,
  p_local_date date,
  p_logs       json,          -- [{exercise_id, set_number, weight, reps, is_warmup?, note?}]
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

  -- Count working sets in the payload (skip null weight/reps).
  select count(*)::int into v_working
    from json_array_elements(p_logs) e
   where (e->>'weight') is not null
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

    if (v_log->>'weight') is null or (v_log->>'weight') = ''
       or (v_log->>'reps') is null or (v_log->>'reps') = '' then
      -- Skip empty placeholder rows (client may send the full set grid).
      continue;
    end if;

    insert into session_logs (
      session_id, exercise_id, set_number, weight, reps,
      is_pr, is_warmup, note, is_skipped
    ) values (
      v_session,
      (v_log->>'exercise_id')::uuid,
      (v_log->>'set_number')::int,
      (v_log->>'weight')::numeric,
      (v_log->>'reps')::int,
      false,
      coalesce((v_log->>'is_warmup')::boolean, false),
      nullif(v_log->>'note', ''),
      false
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

-- uncomplete also needs the allow flag — already set above.

-- delete_session is fine (DELETE privilege, not completion-field UPDATE).

-- ════════════════════════════════════════════════════════════════════════════
-- 6. start_or_resume_session — atomic open-session create
-- ════════════════════════════════════════════════════════════════════════════

create or replace function start_or_resume_session(p_day_type text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  sessions%rowtype;
  v_logs json;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_day_type is null or length(btrim(p_day_type)) = 0 then
    raise exception 'DAY_TYPE_REQUIRED' using errcode = '22023';
  end if;

  select * into v_row
    from sessions
   where user_id = v_user
     and day_type = p_day_type
     and completed_at is null
   order by started_at desc
   limit 1
   for update;

  if v_row.id is null then
    insert into sessions (user_id, day_type)
    values (v_user, p_day_type)
    returning * into v_row;
  end if;

  select coalesce(json_agg(row_to_json(sl) order by sl.set_number), '[]'::json)
    into v_logs
    from session_logs sl
   where sl.session_id = v_row.id;

  return json_build_object(
    'session', row_to_json(v_row),
    'logs',    v_logs,
    'resumed', (select count(*) > 0 from session_logs where session_id = v_row.id)
               or v_row.started_at < now() - interval '5 seconds'
  );
end;
$$;

revoke all on function start_or_resume_session(text) from public, anon;
grant execute on function start_or_resume_session(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. get_exercise_bests — one round-trip for previous bests
-- ════════════════════════════════════════════════════════════════════════════

create or replace function get_exercise_bests(p_exercise_ids uuid[])
returns table (
  exercise_id uuid,
  max_weight  numeric,
  max_volume  numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  select sl.exercise_id,
         max(sl.weight) as max_weight,
         max(sl.weight * sl.reps) as max_volume
    from session_logs sl
    join sessions s on s.id = sl.session_id
   where sl.exercise_id = any (p_exercise_ids)
     and s.user_id = auth.uid()
     and s.completed_at is not null
     and coalesce(sl.is_warmup, false) = false
     and coalesce(sl.is_skipped, false) = false
     and sl.weight is not null
     and sl.reps is not null
   group by sl.exercise_id;
$$;

revoke all on function get_exercise_bests(uuid[]) from public, anon;
grant execute on function get_exercise_bests(uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Rest-day helper — self only
-- ════════════════════════════════════════════════════════════════════════════

create or replace function grind_dates_connected(p_user uuid, p_from date, p_to date)
returns boolean
language plpgsql
stable
strict
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or p_user is distinct from auth.uid() then
    -- Internal definer recompute calls this with the stats user id; only allow
    -- that when the session user matches, OR when this is called from another
    -- security definer that has already authorized. Client callers must match.
    -- When called from grind_recompute_stats (also definer), auth.uid() is the
    -- end user and p_user is always that same uid — so this still holds.
    if auth.uid() is null or p_user is distinct from auth.uid() then
      raise exception 'SELF_ONLY' using errcode = '42501';
    end if;
  end if;

  return not exists (
    select 1
      from generate_series(
             least(p_from, p_to) + 1,
             greatest(p_from, p_to) - 1,
             interval '1 day'
           ) as gs(d)
     where not exists (
             select 1
               from user_rest_days urd
              where urd.user_id = p_user
                and urd.day_of_week = extract(dow from gs.d)::int
           )
       and not exists (
             select 1
               from user_rest_dates urx
              where urx.user_id = p_user
                and urx.rest_date = gs.d::date
           )
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Server-side badge awards — no direct client writes
-- ════════════════════════════════════════════════════════════════════════════

-- Constrain badge_id to the known catalog.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_badges_badge_id_known'
  ) then
    -- Drop any existing rows with unknown ids first.
    delete from user_badges
     where badge_id not in (
       'first_workout','first_pr','streak_3','streak_7','streak_14','streak_30','streak_60',
       'workouts_10','workouts_50','workouts_100','workouts_200','workouts_365',
       'all_three_days','weekend_warrior',
       'pr_5','pr_25','pr_50','pr_100',
       'level_5','level_10','level_15','level_20',
       'volume_100k','volume_500k','volume_1m',
       'plates_225','plates_315','plates_405',
       'early_bird','night_owl','comeback','flawless',
       'rest_day_set','not_alone','rep_machine','weight_tracked','completionist'
     );
    alter table user_badges
      add constraint user_badges_badge_id_known
      check (badge_id in (
       'first_workout','first_pr','streak_3','streak_7','streak_14','streak_30','streak_60',
       'workouts_10','workouts_50','workouts_100','workouts_200','workouts_365',
       'all_three_days','weekend_warrior',
       'pr_5','pr_25','pr_50','pr_100',
       'level_5','level_10','level_15','level_20',
       'volume_100k','volume_500k','volume_1m',
       'plates_225','plates_315','plates_405',
       'early_bird','night_owl','comeback','flawless',
       'rest_day_set','not_alone','rep_machine','weight_tracked','completionist'
      ));
  end if;
end $$;

create or replace function award_earned_badges(
  p_start_hour int default null,
  p_had_no_skips boolean default null
)
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
  v_start_hour int := p_start_hour;
  v_had_comeback boolean := false;
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

  -- Lifetime metrics (mirrors grind_badge_metrics via direct queries).
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

  -- Comeback: ≥15 calendar days between the last two distinct local_dates.
  select array_agg(d order by d desc) into v_dates
    from (
      select distinct local_date as d
        from sessions
       where user_id = v_user and completed_at is not null and local_date is not null
       order by local_date desc
       limit 2
    ) q;
  if coalesce(array_length(v_dates, 1), 0) = 2 then
    v_had_comeback := (v_dates[1] - v_dates[2]) >= 15;
  end if;

  -- Week split / weekend warrior from this ISO week (Mon–Sun), using local_date.
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

  -- Build candidates.
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
  if v_start_hour is not null and v_start_hour < 7 then
    v_candidates := array_append(v_candidates, 'early_bird'); end if;
  if v_start_hour is not null and v_start_hour >= 22 then
    v_candidates := array_append(v_candidates, 'night_owl'); end if;
  if v_had_comeback then v_candidates := array_append(v_candidates, 'comeback'); end if;
  if p_had_no_skips is true then v_candidates := array_append(v_candidates, 'flawless'); end if;
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

  -- Completionist: every other badge.
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

revoke all on function award_earned_badges(int, boolean) from public, anon;
grant execute on function award_earned_badges(int, boolean) to authenticated;

-- Unique pair so ON CONFLICT works for concurrent award attempts.
create unique index if not exists user_badges_user_badge_uidx
  on user_badges (user_id, badge_id);

-- Deny direct client mutations on user_badges. SELECT stays for profile grids.
revoke insert, update, delete on user_badges from authenticated;
-- security definer award_earned_badges runs as owner and retains write.

-- ════════════════════════════════════════════════════════════════════════════
-- 10. Feedback image owner cleanup
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "delete own feedback images" on storage.objects;
create policy "delete own feedback images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'feedback-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ════════════════════════════════════════════════════════════════════════════
-- 11. Home/profile aggregate helpers (bounded)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function grind_home_history(p_lookback_days int default 60)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_lookback int := least(greatest(coalesce(p_lookback_days, 60), 7), 400);
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  return json_build_object(
    'last_trained_by_day', (
      select coalesce(json_object_agg(day_type, local_date), '{}'::json)
        from (
          select distinct on (day_type) day_type, local_date::text
            from sessions
           where user_id = v_user
             and completed_at is not null
             and local_date is not null
           order by day_type, local_date desc
        ) q
    ),
    'recent_local_dates', (
      select coalesce(json_agg(d order by d desc), '[]'::json)
        from (
          select distinct local_date::text as d
            from sessions
           where user_id = v_user
             and completed_at is not null
             and local_date is not null
             and local_date >= (now() at time zone 'utc')::date - v_lookback
        ) q
    ),
    'days_active', (
      select count(distinct local_date)::int
        from sessions
       where user_id = v_user
         and completed_at is not null
         and local_date is not null
    )
  );
end;
$$;

revoke all on function grind_home_history(int) from public, anon;
grant execute on function grind_home_history(int) to authenticated;

commit;
