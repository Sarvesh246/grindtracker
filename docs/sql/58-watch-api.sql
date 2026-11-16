-- Phase 58: Garmin watch API (/api/watch/v1)
-- Idempotent: safe to re-run. Apply AFTER 57-badge-expansion.sql, and BEFORE
-- deploying the app that serves /api/watch/v1 or shows Settings → Watch.
--
-- Adds:
--   1. Provenance + device columns: sessions.source / heart rate / calories,
--      session_logs.source / entered_weight / entered_unit / rest_seconds.
--      Watch rows live in the SAME sessions/session_logs tables as web rows,
--      so every existing screen, stat and leaderboard sees them unchanged.
--   2. watch_devices — one row per paired watch. Only a SHA-256 hash of the
--      token is stored; the plaintext is returned once by create_watch_device.
--   3. create_watch_device / revoke_watch_device — called by the signed-in
--      user from Settings (auth.uid()).
--   4. watch_authenticate / watch_today_context / watch_sync_session — called
--      by the Next.js route with the service-role key ONLY. They take a user id
--      the route derived from the token, so they are revoked from every client
--      role (a client could otherwise pass someone else's id).
--
-- The watch sends client-generated UUIDs for sessions and sets; those become
-- sessions.id / session_logs.id directly, which is what makes re-uploads
-- idempotent (see docs/watch-api.md).

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columns
-- ════════════════════════════════════════════════════════════════════════════

alter table public.sessions
  add column if not exists source text not null default 'web';
alter table public.sessions
  add column if not exists avg_heart_rate smallint;
alter table public.sessions
  add column if not exists max_heart_rate smallint;
alter table public.sessions
  add column if not exists calories integer;

alter table public.session_logs
  add column if not exists source text not null default 'web';
-- `weight` stays canonical lbs (CLAUDE.md "Units"). These keep exactly what
-- the device sent, so the unit is explicit per set and a re-upload of the same
-- set compares equal without float round-trips through the lbs conversion.
alter table public.session_logs
  add column if not exists entered_weight numeric;
alter table public.session_logs
  add column if not exists entered_unit text;
alter table public.session_logs
  add column if not exists rest_seconds integer;

do $$ begin
  alter table public.sessions
    add constraint sessions_source_check check (source in ('web', 'watch'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sessions
    add constraint sessions_heart_rate_range check (
      (avg_heart_rate is null or avg_heart_rate between 20 and 250)
      and (max_heart_rate is null or max_heart_rate between 20 and 250)
    );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.sessions
    add constraint sessions_calories_range check (calories is null or calories between 0 and 20000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.session_logs
    add constraint session_logs_source_check check (source in ('web', 'watch'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.session_logs
    add constraint session_logs_entered_unit_check check (entered_unit is null or entered_unit in ('lbs', 'kg'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.session_logs
    add constraint session_logs_rest_seconds_range check (rest_seconds is null or rest_seconds between 0 and 3600);
exception when duplicate_object then null; end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. watch_devices
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.watch_devices (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- Last 4 characters of the token, so the list can tell two devices apart.
  token_hint      text not null,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  -- Fixed one-minute rate-limit window, updated by watch_authenticate.
  rl_window_start timestamptz,
  rl_count        integer not null default 0
);

create index if not exists watch_devices_user_idx on public.watch_devices (user_id);

alter table public.watch_devices enable row level security;

drop policy if exists "own watch devices select" on public.watch_devices;
create policy "own watch devices select"
  on public.watch_devices for select
  using (auth.uid() = user_id);

-- Writes only through the RPCs below. Clients can read their own rows but not
-- the hash or the rate-limit counters.
revoke all on public.watch_devices from anon, authenticated;
grant select (id, name, token_hint, created_at, last_used_at, revoked_at)
  on public.watch_devices to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Settings RPCs (signed-in user)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.create_watch_device(p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_name  text := btrim(coalesce(p_name, ''));
  v_token text;
  v_row   public.watch_devices%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 40 then
    raise exception 'WATCH_NAME_INVALID: 1-40 characters' using errcode = '22023';
  end if;
  if (select count(*) from public.watch_devices
       where user_id = v_user and revoked_at is null) >= 10 then
    raise exception 'WATCH_DEVICE_LIMIT: revoke a device first' using errcode = '22023';
  end if;

  -- Two v4 UUIDs = 244 random bits from the server's CSPRNG. High entropy is
  -- why a plain SHA-256 (not a slow password hash) is the right storage.
  v_token := 'gwt_' || replace(gen_random_uuid()::text, '-', '')
                    || replace(gen_random_uuid()::text, '-', '');

  insert into public.watch_devices (user_id, name, token_hash, token_hint)
  values (
    v_user,
    v_name,
    encode(sha256(convert_to(v_token, 'UTF8')), 'hex'),
    right(v_token, 4)
  )
  returning * into v_row;

  return json_build_object(
    'id',         v_row.id,
    'name',       v_row.name,
    'token',      v_token,
    'token_hint', v_row.token_hint,
    'created_at', v_row.created_at
  );
end;
$$;

revoke all on function public.create_watch_device(text) from public, anon;
grant execute on function public.create_watch_device(text) to authenticated;

create or replace function public.revoke_watch_device(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  update public.watch_devices
     set revoked_at = now()
   where id = p_id and user_id = v_user and revoked_at is null;
  return found;
end;
$$;

revoke all on function public.revoke_watch_device(uuid) from public, anon;
grant execute on function public.revoke_watch_device(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Watch-side RPCs (service role only)
-- ════════════════════════════════════════════════════════════════════════════

-- Token check + rate limit + last-used stamp in one statement. Returns a
-- status instead of raising so the route can map it to 401/429 directly.
create or replace function public.watch_authenticate(
  p_token_hash text,
  p_limit_per_minute int default 60
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.watch_devices%rowtype;
begin
  update public.watch_devices
     set rl_count = case
           when rl_window_start is null or rl_window_start <= now() - interval '1 minute'
             then 1 else rl_count + 1 end,
         rl_window_start = case
           when rl_window_start is null or rl_window_start <= now() - interval '1 minute'
             then now() else rl_window_start end,
         last_used_at = now()
   where token_hash = p_token_hash
     and revoked_at is null
  returning * into v_row;

  if v_row.id is null then
    if exists (select 1 from public.watch_devices where token_hash = p_token_hash) then
      return json_build_object('status', 'revoked');
    end if;
    return json_build_object('status', 'invalid');
  end if;

  if v_row.rl_count > p_limit_per_minute then
    return json_build_object(
      'status', 'rate_limited',
      'retry_after', greatest(1, ceil(extract(epoch from
        (v_row.rl_window_start + interval '1 minute') - now()))::int)
    );
  end if;

  return json_build_object(
    'status',    'ok',
    'user_id',   v_row.user_id,
    'device_id', v_row.id,
    'device',    v_row.name
  );
end;
$$;

revoke all on function public.watch_authenticate(text, int) from public, anon, authenticated;
grant execute on function public.watch_authenticate(text, int) to service_role;

-- The user's local calendar date for an instant: the watch's own UTC offset
-- when it sent one, else the timezone saved with push prefs, else UTC.
create or replace function public.grind_watch_local_date(
  p_user uuid,
  p_at timestamptz,
  p_offset_seconds int
)
returns date
language sql
stable
set search_path = public
as $$
  select case
    when p_offset_seconds is not null
      then ((p_at at time zone 'utc') + make_interval(secs => p_offset_seconds))::date
    else coalesce(
      (select (p_at at time zone np.timezone)::date
         from public.notification_prefs np
        where np.user_id = p_user
          and exists (select 1 from pg_timezone_names t where t.name = np.timezone)),
      (p_at at time zone 'utc')::date
    )
  end;
$$;

revoke all on function public.grind_watch_local_date(uuid, timestamptz, int) from public, anon, authenticated;

-- Everything GET /today needs in one round trip. "Up next" itself is resolved
-- in TypeScript by the same rotation.ts resolver Home and Log use.
create or replace function public.watch_today_context(
  p_user uuid,
  p_local_date date default null,
  p_offset_seconds int default null
)
returns json
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_date date := grind_safe_local_date(
    coalesce(p_local_date, grind_watch_local_date(p_user, now(), p_offset_seconds)));
begin
  return json_build_object(
    'local_date', v_date,
    'is_rest_day', grind_is_rest_day(p_user, v_date),
    'exercises', coalesce((
      select json_agg(json_build_object(
               'id', e.id,
               'name', e.name,
               'day_type', e.day_type,
               'active', e.active,
               'sets_target', e.sets_target,
               'reps_target', e.reps_target,
               'weight_target', e.weight_target,
               'rest_seconds', e.rest_seconds,
               'sort_order', e.sort_order,
               -- Same fallback as a live web workout: last session's weight.
               'last_weight', (
                 select sl.weight
                   from public.session_logs sl
                   join public.sessions s on s.id = sl.session_id
                  where sl.exercise_id = e.id
                    and s.user_id = p_user
                    and s.completed_at is not null
                    and sl.is_warmup = false
                    and sl.is_skipped = false
                    and sl.weight is not null
                  order by s.completed_at desc, sl.set_number desc
                  limit 1)
             ) order by e.day_type, e.sort_order, e.created_at)
        from public.exercises e
       where e.user_id = p_user), '[]'::json),
    'rotation', (
      select row_to_json(r) from public.user_rotation r where r.user_id = p_user),
    'flex_days', coalesce((
      select json_agg(f.day_key) from public.user_flex_days f where f.user_id = p_user),
      '[]'::json),
    'last_completion', (
      select json_build_object('day', s.day_type, 'completed_at', s.completed_at)
        from public.sessions s
       where s.user_id = p_user and s.completed_at is not null
       order by s.completed_at desc
       limit 1)
  );
end;
$$;

revoke all on function public.watch_today_context(uuid, date, int) from public, anon, authenticated;
grant execute on function public.watch_today_context(uuid, date, int) to service_role;

-- Idempotent upsert of one watch session and any of its sets.
--
-- p_session (already validated by the route; re-checked here where it matters):
--   { id, workout_id?, started_at, ended_at?, utc_offset_seconds?,
--     avg_heart_rate?, max_heart_rate?, calories?,
--     sets: [{ id, exercise_id, set_number, reps, weight_lbs, entered_weight,
--              entered_unit, completed_at, rest_seconds?, is_warmup? }] }
--
-- Session/set ids are the device's UUIDs. A set id seen before is compared
-- with what was stored: identical → "duplicate", different → "updated". A set
-- that cannot be stored is "rejected" with a code; the rest still apply.
-- Errors that make the whole request meaningless raise WATCH_* exceptions.
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
             -- The streak day is the day the workout finished, like a live
             -- web finish, clamped the same way a past-dated log is.
             local_date   = grind_safe_past_date(grind_watch_local_date(p_user, v_ended, v_offset)),
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

commit;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('58-watch-api') on conflict (version) do nothing;
