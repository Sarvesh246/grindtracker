-- Phase 70: Watch diagnostics — battery, timing, sensor availability, raw HR
-- Idempotent: safe to re-run. Apply AFTER 69-all-day-sync.sql, and BEFORE
-- deploying the code that sends 1-second workout traces (a trace longer than
-- 8640 readings fails 59's check). Older watch builds keep working: the new
-- p_day keys are optional.
--
-- Everything here exists to understand the watch itself, not to show the
-- user anything new:
--
--   1. body_sync_log gains, per stored snapshot:
--        taken_at  — the watch's clock when it built the snapshot. Against
--                    received_at it shows the trip time; between background
--                    rows it shows how late the watch wakes the 15-min event.
--        battery, charging, free_mem — the cost of background sync, and how
--                    close the 64 KB background process runs to its limit.
--        hr_t, hr_v — every all-day heart-rate sample the watch stored since
--                    the previous sync, at its own resolution (seconds from
--                    local midnight, bpm). The 15-min averages in daily_body
--                    are built from these; keeping them shows the watch's real
--                    sample rate and what the averaging hides.
--        diag      — the rest: which sensor values the watch fills in and how
--                    old they are (the on-watch probe, now sent), firmware,
--                    part number, Connect IQ version, and the previous
--                    background run's time and result (failed runs never
--                    reach this table otherwise).
--      Kept 30 days instead of 14.
--   2. sessions_hr_shape allows 43,200 trace readings: 12 hours at one per
--      second. The watch now records workout heart rate every second.
--   3. watch_upsert_daily, replaced: writes the new columns.

begin;

-- ── 1. body_sync_log diagnostics ───────────────────────────────────────────

alter table public.body_sync_log add column if not exists taken_at timestamptz;
alter table public.body_sync_log add column if not exists battery  smallint;
alter table public.body_sync_log add column if not exists charging boolean;
alter table public.body_sync_log add column if not exists free_mem integer;
alter table public.body_sync_log add column if not exists hr_t     integer[];
alter table public.body_sync_log add column if not exists hr_v     smallint[];
alter table public.body_sync_log add column if not exists diag     jsonb;

alter table public.body_sync_log drop constraint if exists body_sync_log_shape_70;
alter table public.body_sync_log add constraint body_sync_log_shape_70 check (
  (battery is null or battery between 0 and 100)
  and (cardinality(hr_t) is not distinct from cardinality(hr_v))
  and (hr_t is null or cardinality(hr_t) <= 480)
  and (diag is null or pg_column_size(diag) <= 8192)
);

-- ── 2. one-second workout traces ───────────────────────────────────────────

alter table public.sessions drop constraint if exists sessions_hr_shape;
alter table public.sessions add constraint sessions_hr_shape check (
  (hr_trace is null or cardinality(hr_trace) <= 43200)
  and (hr_step is null or hr_step between 1 and 60)
  and (hr_zones is null or cardinality(hr_zones) <= 6)
  and (zone_seconds is null or cardinality(zone_seconds) = 5)
  and (training_effect is null or training_effect between 0 and 5)
);

-- ── 3. watch_upsert_daily ──────────────────────────────────────────────────

-- p_day: 69's keys, plus hr_raw: { t: int[], v: int[] } and
--        diag: { taken_at, battery, charging, free_mem, … }.
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
  v_diag jsonb;
  v_hr_t integer[];
  v_hr_v smallint[];
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
  select array_agg(v::integer order by o) into v_hr_t
    from jsonb_array_elements_text(p_day->'hr_raw'->'t') with ordinality t(v, o);
  select array_agg(v::smallint order by o) into v_hr_v
    from jsonb_array_elements_text(p_day->'hr_raw'->'v') with ordinality t(v, o);
  v_diag := p_day->'diag';

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
    insert into public.body_sync_log (
      user_id, local_date, source, taken_at, battery, charging, free_mem, hr_t, hr_v, diag
    ) values (
      p_user, v_date, v_source,
      (v_diag->>'taken_at')::timestamptz,
      (v_diag->>'battery')::smallint,
      (v_diag->>'charging')::boolean,
      (v_diag->>'free_mem')::integer,
      v_hr_t, v_hr_v,
      v_diag - 'taken_at' - 'battery' - 'charging' - 'free_mem'
    );
    delete from public.body_sync_log where user_id = p_user and received_at < now() - interval '30 days';
  end if;

  return json_build_object('local_date', r.local_date, 'synced_at', r.synced_at);
end;
$$;

revoke all on function public.watch_upsert_daily(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_upsert_daily(uuid, jsonb) to service_role;

commit;

insert into public.grind_migrations (version) values ('70-watch-diagnostics') on conflict (version) do nothing;
