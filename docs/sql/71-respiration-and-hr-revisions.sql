-- Phase 71: Respiration through the day, and each snapshot's HR averages
-- Idempotent: safe to re-run. Apply AFTER 70-watch-diagnostics.sql. Order
-- against the deploy doesn't matter: older RPCs ignore the new p_day keys,
-- and the web reads resp_series on its own so a database without it still
-- shows everything else.
--
-- What the first day of watch diagnostics (70) turned up:
--
--   1. daily_body.resp_series — breaths per minute, 96 × 15-min buckets from
--      local midnight. The watch's live respiration rate was filled in on 88%
--      of snapshots (the history API has none), so each snapshot places its
--      reading at the bucket it was taken in, like the step totals. The
--      overnight median is the resting respiration Charge compares with your
--      usual.
--   2. body_sync_log.hr_avg — the 15-min HR averages exactly as this snapshot
--      computed them. Some stored buckets were up to 12 bpm off the mean of
--      the raw samples first read for them, which points at Garmin revising
--      its HR history after the fact (sleep, most likely). With every
--      snapshot's own averages kept, npm run watchreport can see a bucket
--      change between snapshots instead of guessing. 30-day retention as 70.
--   3. watch_upsert_daily, replaced: writes both.

begin;

-- ── 1. respiration series ──────────────────────────────────────────────────

alter table public.daily_body add column if not exists resp_series smallint[];

alter table public.daily_body drop constraint if exists daily_body_resp_71;
alter table public.daily_body add constraint daily_body_resp_71 check (
  resp_series is null or cardinality(resp_series) = 96
);

-- ── 2. each snapshot's HR averages ─────────────────────────────────────────

alter table public.body_sync_log add column if not exists hr_avg smallint[];

alter table public.body_sync_log drop constraint if exists body_sync_log_hr_avg_71;
alter table public.body_sync_log add constraint body_sync_log_hr_avg_71 check (
  hr_avg is null or cardinality(hr_avg) = 96
);

-- ── 3. watch_upsert_daily ──────────────────────────────────────────────────

-- p_day: 70's keys, plus resp_series: int[96] (one bucket filled per snapshot).
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
  v_resp smallint[];
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
  select array_agg(nullif(v, 'null')::smallint order by o) into v_resp
    from jsonb_array_elements_text(p_day->'resp_series') with ordinality t(v, o);
  select array_agg(v::integer order by o) into v_hr_t
    from jsonb_array_elements_text(p_day->'hr_raw'->'t') with ordinality t(v, o);
  select array_agg(v::smallint order by o) into v_hr_v
    from jsonb_array_elements_text(p_day->'hr_raw'->'v') with ordinality t(v, o);
  v_diag := p_day->'diag';

  insert into public.daily_body as d (
    user_id, local_date, bb_series, stress_series, hr_series, steps_series, active_series, floors_series, resp_series,
    bb_high, bb_low, bb_latest, bb_wake,
    stress_avg, resting_hr, recovery_hours, steps, active_minutes, floors, spo2, vo2max, synced_at
  ) values (
    p_user, v_date, v_bb, v_st, v_hr, v_steps, v_active, v_floors, v_resp,
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
    resp_series    = public.grind_merge_series(d.resp_series, excluded.resp_series),
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
      user_id, local_date, source, taken_at, battery, charging, free_mem, hr_t, hr_v, hr_avg, diag
    ) values (
      p_user, v_date, v_source,
      (v_diag->>'taken_at')::timestamptz,
      (v_diag->>'battery')::smallint,
      (v_diag->>'charging')::boolean,
      (v_diag->>'free_mem')::integer,
      v_hr_t, v_hr_v,
      case when cardinality(v_hr) = 96 then v_hr end,
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

insert into public.grind_migrations (version) values ('71-respiration-and-hr-revisions') on conflict (version) do nothing;
