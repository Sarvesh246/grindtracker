-- Phase 59: GRIND Body — watch heart-rate traces, per-set effort, daily body snapshot
-- Idempotent: safe to re-run. Apply AFTER 58-watch-api.sql, and BEFORE
-- deploying the app that sends or reads body data.
--
-- Adds:
--   1. sessions.hr_trace / hr_step / hr_zones / zone_seconds / training_effect
--      and session_logs.hr_peak / hr_end / hr_rest_drop_60. Display and advice
--      only: none of these feed XP, streaks, PRs or the leaderboard, so
--      grind_recompute_stats is untouched.
--   2. daily_body — one row per user per local date, written by the watch.
--   3. body_prefs — the user's Settings → Watch switches for this data.
--   4. watch_store_session_body / watch_upsert_daily — service-role only, like
--      the other watch_* RPCs (the route derives p_user from the device token).
--   5. delete_body_data() for Settings, and delete_my_grind_data() now also
--      wipes daily_body and body_prefs.
--
-- Privacy: every new row is owner-only. No friend, leaderboard or share RPC
-- reads any of it. Full traces are kept 180 days; older ones are trimmed to
-- the per-set peaks on the next upload.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Columns
-- ════════════════════════════════════════════════════════════════════════════

alter table public.sessions add column if not exists hr_trace smallint[];
-- Seconds between trace samples. The trace starts at started_at.
alter table public.sessions add column if not exists hr_step smallint;
-- The user's zone floors when this was recorded (zone 1..5 lower bounds + max),
-- so old workouts keep their colours if the zones change later.
alter table public.sessions add column if not exists hr_zones smallint[];
alter table public.sessions add column if not exists zone_seconds integer[];
alter table public.sessions add column if not exists training_effect numeric(2,1);

alter table public.session_logs add column if not exists hr_peak smallint;
alter table public.session_logs add column if not exists hr_end smallint;
alter table public.session_logs add column if not exists hr_rest_drop_60 smallint;

do $$ begin
  alter table public.sessions add constraint sessions_hr_shape check (
    (hr_trace is null or cardinality(hr_trace) <= 8640)
    and (hr_step is null or hr_step between 1 and 60)
    and (hr_zones is null or cardinality(hr_zones) <= 6)
    and (zone_seconds is null or cardinality(zone_seconds) = 5)
    and (training_effect is null or training_effect between 0 and 5)
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.session_logs add constraint session_logs_hr_range check (
    (hr_peak is null or hr_peak between 20 and 250)
    and (hr_end is null or hr_end between 20 and 250)
    and (hr_rest_drop_60 is null or hr_rest_drop_60 between -100 and 200)
  );
exception when duplicate_object then null; end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. daily_body
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.daily_body (
  user_id         uuid not null references auth.users(id) on delete cascade,
  local_date      date not null,
  -- 96 buckets of 15 minutes from local midnight; null where nothing was read.
  bb_series       smallint[],
  stress_series   smallint[],
  bb_high         smallint,
  bb_low          smallint,
  bb_latest       smallint,
  bb_wake         smallint,
  stress_avg      smallint,
  resting_hr      smallint,
  recovery_hours  smallint,
  steps           integer,
  active_minutes  smallint,
  floors          smallint,
  spo2            smallint,
  vo2max          smallint,
  synced_at       timestamptz not null default now(),
  primary key (user_id, local_date),
  constraint daily_body_ranges check (
    (bb_series is null or cardinality(bb_series) = 96)
    and (stress_series is null or cardinality(stress_series) = 96)
    and (resting_hr is null or resting_hr between 20 and 150)
    and (recovery_hours is null or recovery_hours between 0 and 200)
    and (spo2 is null or spo2 between 50 and 100)
    and (vo2max is null or vo2max between 10 and 100)
  )
);

alter table public.daily_body enable row level security;

drop policy if exists "own daily body select" on public.daily_body;
create policy "own daily body select"
  on public.daily_body for select
  using (auth.uid() = user_id);

-- Writes only through watch_upsert_daily (service role) and delete_body_data.
revoke all on public.daily_body from anon, authenticated;
grant select on public.daily_body to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. body_prefs
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.body_prefs (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  coach_uses_body boolean not null default true,
  smart_rest      boolean not null default false,
  updated_at      timestamptz not null default now()
);

alter table public.body_prefs enable row level security;

drop policy if exists "own body prefs select" on public.body_prefs;
create policy "own body prefs select" on public.body_prefs
  for select using (auth.uid() = user_id);
drop policy if exists "own body prefs insert" on public.body_prefs;
create policy "own body prefs insert" on public.body_prefs
  for insert with check (auth.uid() = user_id);
drop policy if exists "own body prefs update" on public.body_prefs;
create policy "own body prefs update" on public.body_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

revoke all on public.body_prefs from anon;
grant select, insert, update on public.body_prefs to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Watch RPCs (service role only)
-- ════════════════════════════════════════════════════════════════════════════

-- Elementwise merge of two 96-bucket series: a new reading wins, a gap keeps
-- what an earlier snapshot already saw (history on the watch only reaches back
-- a few hours, so each open fills in its own stretch of the day).
create or replace function public.grind_merge_series(p_old smallint[], p_new smallint[])
returns smallint[]
language sql
immutable
set search_path = public
as $$
  select case
    when p_new is null then p_old
    when p_old is null then p_new
    else (select array_agg(coalesce(p_new[i], p_old[i]) order by i) from generate_series(1, 96) i)
  end;
$$;

revoke all on function public.grind_merge_series(smallint[], smallint[]) from public, anon, authenticated;

-- p_body: { session_id, trace: int[], step, zones: int[], zone_seconds: int[5],
--           training_effect, sets: [{ id, hr_peak, hr_end, hr_rest_drop_60 }] }
-- Overwrites (idempotent). Only touches a session p_user owns.
create or replace function public.watch_store_session_body(p_user uuid, p_body jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sid  uuid := (p_body->>'session_id')::uuid;
  v_sets int := 0;
begin
  -- A JSON null array would make jsonb_array_elements_text throw.
  p_body := jsonb_strip_nulls(p_body);
  if not exists (select 1 from public.sessions where id = v_sid and user_id = p_user) then
    raise exception 'WATCH_SESSION_NOT_FOUND' using errcode = '22023';
  end if;

  update public.sessions
     set hr_trace        = coalesce(
                             (select array_agg(nullif(v::int, 0)::smallint order by o)
                                from jsonb_array_elements_text(p_body->'trace') with ordinality t(v, o)),
                             hr_trace),
         hr_step         = coalesce((p_body->>'step')::smallint, hr_step),
         hr_zones        = coalesce(
                             (select array_agg(v::smallint order by o)
                                from jsonb_array_elements_text(p_body->'zones') with ordinality t(v, o)),
                             hr_zones),
         zone_seconds    = coalesce(
                             (select array_agg(v::int order by o)
                                from jsonb_array_elements_text(p_body->'zone_seconds') with ordinality t(v, o)),
                             zone_seconds),
         training_effect = coalesce((p_body->>'training_effect')::numeric(2,1), training_effect)
   where id = v_sid and user_id = p_user;

  update public.session_logs l
     set hr_peak         = (s->>'hr_peak')::smallint,
         hr_end          = (s->>'hr_end')::smallint,
         hr_rest_drop_60 = (s->>'hr_rest_drop_60')::smallint
    from jsonb_array_elements(coalesce(p_body->'sets', '[]'::jsonb)) s
   where l.id = (s->>'id')::uuid
     and l.session_id = v_sid;
  get diagnostics v_sets = row_count;

  -- Retention: full traces for 180 days, then only the per-set numbers.
  update public.sessions
     set hr_trace = null
   where user_id = p_user
     and hr_trace is not null
     and started_at < now() - interval '180 days';

  return json_build_object('session_id', v_sid, 'sets_updated', v_sets);
end;
$$;

revoke all on function public.watch_store_session_body(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_store_session_body(uuid, jsonb) to service_role;

-- p_day: { local_date, bb: int[96], stress: int[96], bb_high, bb_low, bb_latest,
--          bb_wake, stress_avg, resting_hr, recovery_hours, steps,
--          active_minutes, floors, spo2, vo2max }
-- The route derives the aggregates; series merge with what is already stored.
create or replace function public.watch_upsert_daily(p_user uuid, p_day jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := (p_day->>'local_date')::date;
  v_bb smallint[];
  v_st smallint[];
  r public.daily_body;
begin
  p_day := jsonb_strip_nulls(p_day);
  if v_date is null or v_date > current_date + 1 or v_date < current_date - 30 then
    raise exception 'WATCH_BAD_DATE' using errcode = '22023';
  end if;

  select array_agg(nullif(v, 'null')::smallint order by o) into v_bb
    from jsonb_array_elements_text(p_day->'bb') with ordinality t(v, o);
  select array_agg(nullif(v, 'null')::smallint order by o) into v_st
    from jsonb_array_elements_text(p_day->'stress') with ordinality t(v, o);

  insert into public.daily_body as d (
    user_id, local_date, bb_series, stress_series, bb_high, bb_low, bb_latest, bb_wake,
    stress_avg, resting_hr, recovery_hours, steps, active_minutes, floors, spo2, vo2max, synced_at
  ) values (
    p_user, v_date, v_bb, v_st,
    (p_day->>'bb_high')::smallint, (p_day->>'bb_low')::smallint,
    (p_day->>'bb_latest')::smallint, (p_day->>'bb_wake')::smallint,
    (p_day->>'stress_avg')::smallint, (p_day->>'resting_hr')::smallint,
    (p_day->>'recovery_hours')::smallint, (p_day->>'steps')::int,
    (p_day->>'active_minutes')::smallint, (p_day->>'floors')::smallint,
    (p_day->>'spo2')::smallint, (p_day->>'vo2max')::smallint, now()
  )
  on conflict (user_id, local_date) do update set
    bb_series      = public.grind_merge_series(d.bb_series, excluded.bb_series),
    stress_series  = public.grind_merge_series(d.stress_series, excluded.stress_series),
    -- A later snapshot can see less history than an earlier one, so extremes
    -- only ever widen; "latest" and the counters take the newest reading.
    bb_high        = greatest(d.bb_high, excluded.bb_high),
    bb_low         = least(d.bb_low, excluded.bb_low),
    bb_latest      = coalesce(excluded.bb_latest, d.bb_latest),
    bb_wake        = greatest(d.bb_wake, excluded.bb_wake),
    stress_avg     = coalesce(excluded.stress_avg, d.stress_avg),
    resting_hr     = coalesce(excluded.resting_hr, d.resting_hr),
    recovery_hours = coalesce(excluded.recovery_hours, d.recovery_hours),
    steps          = greatest(d.steps, excluded.steps),
    active_minutes = greatest(d.active_minutes, excluded.active_minutes),
    floors         = greatest(d.floors, excluded.floors),
    spo2           = coalesce(excluded.spo2, d.spo2),
    vo2max         = coalesce(excluded.vo2max, d.vo2max),
    synced_at      = now()
  returning * into r;

  return json_build_object('local_date', r.local_date, 'synced_at', r.synced_at);
end;
$$;

revoke all on function public.watch_upsert_daily(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_upsert_daily(uuid, jsonb) to service_role;

-- What /today needs to compute Charge: the last 35 days of daily_body, the
-- last 28 days of finished sessions' load inputs, and the user's prefs.
create or replace function public.watch_body_context(p_user uuid, p_local_date date)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'days', coalesce((
      select json_agg(json_build_object(
        'local_date', d.local_date, 'bb_high', d.bb_high, 'bb_low', d.bb_low,
        'bb_latest', d.bb_latest, 'bb_wake', d.bb_wake, 'stress_avg', d.stress_avg,
        'resting_hr', d.resting_hr, 'recovery_hours', d.recovery_hours,
        'steps', d.steps, 'synced_at', d.synced_at) order by d.local_date)
      from public.daily_body d
     where d.user_id = p_user
       and d.local_date between p_local_date - 35 and p_local_date), '[]'::json),
    'sessions', coalesce((
      select json_agg(json_build_object(
        'local_date', s.local_date, 'started_at', s.started_at,
        'completed_at', s.completed_at, 'zone_seconds', s.zone_seconds) order by s.completed_at)
      from public.sessions s
     where s.user_id = p_user
       and s.completed_at is not null
       and s.local_date between p_local_date - 28 and p_local_date), '[]'::json),
    'prefs', (select json_build_object('coach_uses_body', p.coach_uses_body, 'smart_rest', p.smart_rest)
                from public.body_prefs p where p.user_id = p_user)
  );
$$;

revoke all on function public.watch_body_context(uuid, date) from public, anon, authenticated;
grant execute on function public.watch_body_context(uuid, date) to service_role;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Deleting body data
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.delete_body_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  delete from public.daily_body where user_id = uid;
  update public.sessions
     set hr_trace = null, hr_step = null, hr_zones = null,
         zone_seconds = null, training_effect = null,
         avg_heart_rate = null, max_heart_rate = null, calories = null
   where user_id = uid
     and (hr_trace is not null or zone_seconds is not null or avg_heart_rate is not null
          or max_heart_rate is not null or calories is not null or training_effect is not null);
  update public.session_logs
     set hr_peak = null, hr_end = null, hr_rest_drop_60 = null
   where session_id in (select id from public.sessions where user_id = uid)
     and (hr_peak is not null or hr_end is not null or hr_rest_drop_60 is not null);
end;
$$;

revoke all on function public.delete_body_data() from public, anon;
grant execute on function public.delete_body_data() to authenticated;

-- Same body as 50-delete-my-data-complete.sql, plus daily_body and body_prefs.
create or replace function public.delete_my_grind_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  begin
    delete from storage.objects
     where bucket_id in ('progress-photos', 'feedback-images')
       and split_part(name, '/', 1) = uid::text;
  exception
    when undefined_table then
      null;
    when invalid_schema_name then
      null;
  end;

  delete from public.session_logs
    where session_id in (select id from public.sessions where user_id = uid);
  delete from public.sessions where user_id = uid;
  delete from public.exercises where user_id = uid;
  delete from public.user_stats where user_id = uid;
  delete from public.user_badges where user_id = uid;
  delete from public.body_weights where user_id = uid;
  delete from public.user_day_categories where user_id = uid;
  if to_regclass('public.user_day_colors') is not null then
    delete from public.user_day_colors where user_id = uid;
  end if;
  delete from public.user_rotation where user_id = uid;
  delete from public.user_rest_cancels where user_id = uid;
  delete from public.user_rest_days where user_id = uid;
  delete from public.user_rest_dates where user_id = uid;
  if to_regclass('public.user_flex_days') is not null then
    delete from public.user_flex_days where user_id = uid;
  end if;
  delete from public.feedback where user_id = uid;
  delete from public.friendships
    where requester_id = uid or addressee_id = uid;

  if to_regclass('public.progress_photo_groups') is not null then
    delete from public.progress_photos
      where group_id in (select id from public.progress_photo_groups where user_id = uid);
    delete from public.progress_photo_groups where user_id = uid;
  end if;

  if to_regclass('public.push_subscriptions') is not null then
    delete from public.push_subscriptions where user_id = uid;
  end if;
  if to_regclass('public.notification_prefs') is not null then
    delete from public.notification_prefs where user_id = uid;
  end if;
  if to_regclass('public.scheduled_notifications') is not null then
    delete from public.scheduled_notifications where user_id = uid;
  end if;

  if to_regclass('public.coach_action_proposals') is not null then
    delete from public.coach_action_proposals where user_id = uid;
  end if;
  if to_regclass('public.coach_messages') is not null then
    delete from public.coach_messages where user_id = uid;
  end if;
  if to_regclass('public.coach_conversations') is not null then
    delete from public.coach_conversations where user_id = uid;
  end if;

  delete from public.daily_body where user_id = uid;
  delete from public.body_prefs where user_id = uid;

  delete from public.user_profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_grind_data() from public;
grant execute on function public.delete_my_grind_data() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Coach: propose_adjust_today ("a lighter version of today")
-- ════════════════════════════════════════════════════════════════════════════
-- Restates 56's full kind list plus adjust_today, dropping whatever kind check
-- exists first, so it's correct whichever migration last touched it.

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'coach_action_proposals'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%kind%'
  loop
    execute format('alter table public.coach_action_proposals drop constraint if exists %I', r.conname);
  end loop;
end $$;

alter table public.coach_action_proposals
  add constraint coach_action_proposals_kind_check
  check (kind in (
    'correct_weights',
    'start_workout',
    'create_day',
    'log_body_weight',
    'delete_body_weight',
    'finish_workout',
    'undo_finish_workout',
    'skip_sets',
    'toggle_rest_today',
    'set_rest_weekday',
    'edit_exercise',
    'update_rotation',
    'edit_session_log',
    'update_notification_prefs',
    'apply_weekly_plan',
    'set_day_enabled',
    'adjust_today'
  ));

commit;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('59-body-data') on conflict (version) do nothing;
