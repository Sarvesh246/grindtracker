-- Phase 69: All-day watch sync — heart rate and activity curves, and a sync log
-- Idempotent: safe to re-run. Apply AFTER 68-readiness-and-tuning.sql, and
-- BEFORE deploying the code that reads the new daily_body columns. (Older code
-- and older watch builds keep working: the extra p_day keys are ignored by the
-- 59 version of watch_upsert_daily, and nothing old reads the new columns.)
--
-- The watch now wakes every 15 minutes with the app closed, so the day fills
-- in through the day the way Garmin Connect's does.
--
-- Adds:
--   1. daily_body.hr_series — all-day heart rate, 96 × 15-min bucket averages
--      from local midnight (SensorHistory on the watch).
--      daily_body.steps_series / active_series / floors_series — the day's
--      running totals as seen at each sync, at the bucket the sync happened
--      in. The watch only knows totals, so the curve is built one sync at a
--      time; with 15-minute syncs it's close to Garmin's own.
--   2. body_sync_log — one row per snapshot that was stored: when it arrived
--      and whether the watch app was open or it came from the background
--      service. Kept 14 days. Lets the Health page say "Received 2:14 PM
--      (background)" and shows whether background sync really fires.
--   3. watch_upsert_daily, replaced: merges the new series and writes the log.
--   4. delete_health_history, replaced: also wipes body_sync_log.

begin;

-- ── 1. new daily_body series ───────────────────────────────────────────────

alter table public.daily_body add column if not exists hr_series     smallint[];
alter table public.daily_body add column if not exists steps_series  integer[];
alter table public.daily_body add column if not exists active_series smallint[];
alter table public.daily_body add column if not exists floors_series smallint[];

alter table public.daily_body drop constraint if exists daily_body_series_69;
alter table public.daily_body add constraint daily_body_series_69 check (
  (hr_series is null or cardinality(hr_series) = 96)
  and (steps_series is null or cardinality(steps_series) = 96)
  and (active_series is null or cardinality(active_series) = 96)
  and (floors_series is null or cardinality(floors_series) = 96)
);

-- grind_merge_series (59) for integer arrays: a new reading wins, a gap keeps
-- what an earlier snapshot already saw.
create or replace function public.grind_merge_int_series(p_old integer[], p_new integer[])
returns integer[]
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

revoke all on function public.grind_merge_int_series(integer[], integer[]) from public, anon, authenticated;

-- ── 2. body_sync_log ───────────────────────────────────────────────────────

create table if not exists public.body_sync_log (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  local_date  date not null,
  received_at timestamptz not null default now(),
  source      text not null check (source in ('app', 'background'))
);

create index if not exists body_sync_log_user_received
  on public.body_sync_log (user_id, received_at desc);

alter table public.body_sync_log enable row level security;

drop policy if exists "own body sync log select" on public.body_sync_log;
create policy "own body sync log select"
  on public.body_sync_log for select
  using (auth.uid() = user_id);

-- Writes only through watch_upsert_daily (service role).
revoke all on public.body_sync_log from anon, authenticated;
grant select on public.body_sync_log to authenticated;

-- ── 3. watch_upsert_daily ──────────────────────────────────────────────────

-- p_day: 59's keys, plus hr: int[96], steps_series: int[96],
--        active_series: int[96], floors_series: int[96],
--        source: 'app' | 'background'.
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
  v_hr smallint[];
  v_steps integer[];
  v_active smallint[];
  v_floors smallint[];
  v_source text;
  r public.daily_body;
begin
  p_day := jsonb_strip_nulls(p_day);
  if v_date is null or v_date > current_date + 1 or v_date < current_date - 30 then
    raise exception 'WATCH_BAD_DATE' using errcode = '22023';
  end if;
  v_source := case when p_day->>'source' = 'background' then 'background' else 'app' end;

  select array_agg(nullif(v, 'null')::smallint order by o) into v_bb
    from jsonb_array_elements_text(p_day->'bb') with ordinality t(v, o);
  select array_agg(nullif(v, 'null')::smallint order by o) into v_st
    from jsonb_array_elements_text(p_day->'stress') with ordinality t(v, o);
  select array_agg(nullif(v, 'null')::smallint order by o) into v_hr
    from jsonb_array_elements_text(p_day->'hr') with ordinality t(v, o);
  select array_agg(nullif(v, 'null')::integer order by o) into v_steps
    from jsonb_array_elements_text(p_day->'steps_series') with ordinality t(v, o);
  select array_agg(nullif(v, 'null')::smallint order by o) into v_active
    from jsonb_array_elements_text(p_day->'active_series') with ordinality t(v, o);
  select array_agg(nullif(v, 'null')::smallint order by o) into v_floors
    from jsonb_array_elements_text(p_day->'floors_series') with ordinality t(v, o);

  insert into public.daily_body as d (
    user_id, local_date, bb_series, stress_series, hr_series, steps_series, active_series, floors_series,
    bb_high, bb_low, bb_latest, bb_wake,
    stress_avg, resting_hr, recovery_hours, steps, active_minutes, floors, spo2, vo2max, synced_at
  ) values (
    p_user, v_date, v_bb, v_st, v_hr, v_steps, v_active, v_floors,
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
    hr_series      = public.grind_merge_series(d.hr_series, excluded.hr_series),
    steps_series   = public.grind_merge_int_series(d.steps_series, excluded.steps_series),
    active_series  = public.grind_merge_series(d.active_series, excluded.active_series),
    floors_series  = public.grind_merge_series(d.floors_series, excluded.floors_series),
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

  -- The health collection gate (61) drops the row when collection is off; log
  -- only what was actually stored.
  if r.local_date is not null then
    insert into public.body_sync_log (user_id, local_date, source) values (p_user, v_date, v_source);
    delete from public.body_sync_log where user_id = p_user and received_at < now() - interval '14 days';
  end if;

  return json_build_object('local_date', r.local_date, 'synced_at', r.synced_at);
end;
$$;

revoke all on function public.watch_upsert_daily(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_upsert_daily(uuid, jsonb) to service_role;

-- ── 4. delete_health_history ───────────────────────────────────────────────

create or replace function public.delete_health_history()
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform public.set_health_collection(false);
  delete from public.health_connections where user_id = uid;
  delete from public.health_daily_summaries where user_id = uid;
  delete from public.health_insights where user_id = uid;
  delete from public.readiness_checks where user_id = uid;
  delete from public.body_sync_log where user_id = uid;
end $$;
revoke all on function public.delete_health_history() from public, anon, authenticated;

commit;

insert into public.grind_migrations (version) values ('69-all-day-sync') on conflict (version) do nothing;
