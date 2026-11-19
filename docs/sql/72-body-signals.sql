-- Phase 72: Body signals (early signs of strain or illness), and clean Body Battery
-- Idempotent: safe to re-run. Apply AFTER 71-respiration-and-hr-revisions.sql.
-- Order against the deploy doesn't matter: the code treats every new field as
-- optional, and older RPCs ignore the new p_day key.
--
--   1. Body Battery cleaning. The watch's Body Battery history sometimes ends
--      in readings that can't be real (Nov 17 ended "5 15 65 93" in its last
--      45 minutes), and because bb_high / bb_wake merged with greatest(), one
--      glitch became the day's value for good: two days read "woke at 93" when
--      Body Battery never passed 64 and 48. grind_clean_bb drops any reading
--      that rises more than 10 or falls more than 15 per 15-min bucket from the
--      last accepted one (Body Battery charges a few points an hour asleep and
--      drains a few an hour awake). The day's high, low, wake peak and latest
--      are now always derived from the cleaned, merged series, and every
--      stored row is repaired.
--   2. daily_body.temp_series — the watch's wrist temperature, tenths of a °C,
--      at the bucket each snapshot was taken in. A weak signal on its own
--      (the sensor reads skin and room together), used only to back up others.
--   3. body_signal_labels — what the user says a flagged morning was (sick,
--      alcohol, poor sleep, …), so we can tell how often the signal is right
--      for them. Owner reads and writes; wiped by delete_health_history.
--   4. watch_body_context, replaced: carries the nightly series and labels so
--      the watch's /today gets the same body signals and respiration Charge.
--   5. watch_queue_body_signal + the body_signal notification kind: one push
--      per morning when the signals are strong. notification_prefs gains
--      body_signal_alerts (on by default).
--   6. watch_upsert_daily, replaced: writes temp_series and runs 1.

begin;

-- ── 1. Body Battery cleaning ───────────────────────────────────────────────

-- Readings that move faster than Body Battery can are dropped. The allowance
-- grows with the gap since the last accepted reading. Four rejections in a
-- row mean the anchor itself was the bad reading, so the next one becomes the
-- anchor instead.
create or replace function public.grind_clean_bb(p smallint[])
returns smallint[]
language plpgsql
immutable
set search_path = public
as $$
declare
  v_out smallint[];
  v_last smallint;
  v_last_i int;
  v_rejects int := 0;
  v smallint;
  v_gap int;
begin
  if p is null then return null; end if;
  v_out := array_fill(null::smallint, array[cardinality(p)]);
  for i in 1 .. cardinality(p) loop
    v := p[i];
    continue when v is null;
    if v_last is null then
      v_out[i] := v; v_last := v; v_last_i := i; v_rejects := 0;
      continue;
    end if;
    v_gap := i - v_last_i;
    if (v - v_last) <= 10 * v_gap and (v_last - v) <= 15 * v_gap then
      v_out[i] := v; v_last := v; v_last_i := i; v_rejects := 0;
    else
      v_rejects := v_rejects + 1;
      if v_rejects >= 4 then
        v_out[i] := v; v_last := v; v_last_i := i; v_rejects := 0;
      end if;
    end if;
  end loop;
  return v_out;
end;
$$;

revoke all on function public.grind_clean_bb(smallint[]) from public, anon, authenticated;

-- Cleans one stored day and derives its Body Battery numbers from the series.
create or replace function public.grind_refresh_bb(p_user uuid, p_date date)
returns void
language sql
security definer
set search_path = public
as $$
  with c as (
    select public.grind_clean_bb(d.bb_series) as s
      from public.daily_body d
     where d.user_id = p_user and d.local_date = p_date and d.bb_series is not null
  ), agg as (
    select c.s,
           (select max(v) from unnest(c.s) v) as hi,
           (select min(v) from unnest(c.s) v) as lo,
           (select max(v) from unnest(c.s[1:48]) v) as wake,
           (select v from unnest(c.s) with ordinality t(v, o) where v is not null order by o desc limit 1) as latest
      from c
  )
  update public.daily_body d
     set bb_series = agg.s, bb_high = agg.hi, bb_low = agg.lo, bb_wake = agg.wake, bb_latest = agg.latest
    from agg
   where d.user_id = p_user and d.local_date = p_date;
$$;

revoke all on function public.grind_refresh_bb(uuid, date) from public, anon, authenticated;

-- ── 2. temperature series ──────────────────────────────────────────────────

alter table public.daily_body add column if not exists temp_series smallint[];

alter table public.daily_body drop constraint if exists daily_body_temp_72;
alter table public.daily_body add constraint daily_body_temp_72 check (
  temp_series is null or cardinality(temp_series) = 96
);

-- ── 3. labels ──────────────────────────────────────────────────────────────

create table if not exists public.body_signal_labels (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  local_date date        not null,
  tags       text[]      not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date),
  constraint body_signal_labels_tags check (
    cardinality(tags) between 1 and 6
    and tags <@ array['sick', 'alcohol', 'poor_sleep', 'hard_training', 'stress', 'travel', 'fine']
  )
);

alter table public.body_signal_labels enable row level security;
revoke all on public.body_signal_labels from anon;
grant select, insert, update, delete on public.body_signal_labels to authenticated;

drop policy if exists "own body signal labels select" on public.body_signal_labels;
create policy "own body signal labels select" on public.body_signal_labels
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "own body signal labels insert" on public.body_signal_labels;
create policy "own body signal labels insert" on public.body_signal_labels
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "own body signal labels update" on public.body_signal_labels;
create policy "own body signal labels update" on public.body_signal_labels
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own body signal labels delete" on public.body_signal_labels;
create policy "own body signal labels delete" on public.body_signal_labels
  for delete to authenticated using (user_id = auth.uid());

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
  delete from public.body_signal_labels where user_id = uid;
end $$;
revoke all on function public.delete_health_history() from public, anon, authenticated;

-- ── 4. watch_body_context ──────────────────────────────────────────────────

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
        'steps', d.steps, 'synced_at', d.synced_at,
        'bb_series', d.bb_series, 'stress_series', d.stress_series, 'hr_series', d.hr_series,
        'resp_series', d.resp_series, 'temp_series', d.temp_series) order by d.local_date)
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
    'readiness', coalesce((
      select json_agg(json_build_object(
        'local_date', r.local_date, 'measured_at', r.measured_at, 'rmssd', r.rmssd,
        'ln_rmssd', r.ln_rmssd, 'mean_hr', r.mean_hr, 'quality', r.quality) order by r.measured_at)
      from public.readiness_checks r
     where r.user_id = p_user
       and r.local_date between p_local_date - 60 and p_local_date), '[]'::json),
    'strength', coalesce((
      select json_agg(json_build_object(
        'local_date', s.local_date, 'exercise_id', l.exercise_id, 'weight', l.weight, 'reps', l.reps))
      from public.session_logs l
      join public.sessions s on s.id = l.session_id
     where s.user_id = p_user
       and s.completed_at is not null
       and s.local_date between p_local_date - 90 and p_local_date
       and l.is_warmup = false
       and l.is_skipped = false
       and l.reps is not null), '[]'::json),
    'labels', coalesce((
      select json_agg(json_build_object('local_date', b.local_date, 'tags', b.tags) order by b.local_date)
      from public.body_signal_labels b
     where b.user_id = p_user
       and b.local_date between p_local_date - 90 and p_local_date), '[]'::json),
    'prefs', (select json_build_object('coach_uses_body', p.coach_uses_body, 'smart_rest', p.smart_rest)
                from public.body_prefs p where p.user_id = p_user)
  );
$$;

revoke all on function public.watch_body_context(uuid, date) from public, anon, authenticated;
grant execute on function public.watch_body_context(uuid, date) to service_role;

-- ── 5. the morning push ────────────────────────────────────────────────────

alter table public.notification_prefs
  add column if not exists body_signal_alerts boolean not null default true;

alter table public.scheduled_notifications drop constraint if exists scheduled_notifications_kind_check;
alter table public.scheduled_notifications add constraint scheduled_notifications_kind_check
  check (kind in (
    'rest_end', 'rest_warn', 'streak_daily',
    'energy_morning_peak', 'energy_dip', 'energy_evening_peak', 'energy_wind_down',
    'body_signal'
  ));

-- One per user per local date, whatever calls it. Skipped when the user turned
-- the alert off. Returns true when a row was queued.
create or replace function public.watch_queue_body_signal(p_user uuid, p_local_date date, p_payload jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if exists (select 1 from public.notification_prefs n where n.user_id = p_user and n.body_signal_alerts = false) then
    return false;
  end if;
  insert into public.scheduled_notifications (user_id, kind, fire_at, payload, dedupe_key)
  values (p_user, 'body_signal', now(), coalesce(p_payload, '{}'::jsonb),
          'body_signal:' || p_user::text || ':' || p_local_date::text)
  on conflict (dedupe_key) do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;

revoke all on function public.watch_queue_body_signal(uuid, date, jsonb) from public, anon, authenticated;
grant execute on function public.watch_queue_body_signal(uuid, date, jsonb) to service_role;

-- ── 6. watch_upsert_daily ──────────────────────────────────────────────────

-- p_day: 71's keys, plus temp_series: int[96] (tenths of a °C). The Body
-- Battery aggregates the caller sends are ignored: grind_refresh_bb derives
-- them from the cleaned, merged series.
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
  v_temp smallint[];
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
  select array_agg(nullif(v, 'null')::smallint order by o) into v_temp
    from jsonb_array_elements_text(p_day->'temp_series') with ordinality t(v, o);
  select array_agg(v::integer order by o) into v_hr_t
    from jsonb_array_elements_text(p_day->'hr_raw'->'t') with ordinality t(v, o);
  select array_agg(v::smallint order by o) into v_hr_v
    from jsonb_array_elements_text(p_day->'hr_raw'->'v') with ordinality t(v, o);
  v_diag := p_day->'diag';

  insert into public.daily_body as d (
    user_id, local_date, bb_series, stress_series, hr_series, steps_series, active_series, floors_series,
    resp_series, temp_series,
    stress_avg, resting_hr, recovery_hours, steps, active_minutes, floors, spo2, vo2max, synced_at
  ) values (
    p_user, v_date, v_bb, v_st, v_hr, v_steps, v_active, v_floors, v_resp, v_temp,
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
    temp_series    = public.grind_merge_series(d.temp_series, excluded.temp_series),
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
    perform public.grind_refresh_bb(p_user, v_date);
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

-- ── repair: every stored day, cleaned and re-derived ───────────────────────

do $$
declare r record;
begin
  for r in select user_id, local_date from public.daily_body where bb_series is not null loop
    perform public.grind_refresh_bb(r.user_id, r.local_date);
  end loop;
end $$;

commit;

insert into public.grind_migrations (version) values ('72-body-signals') on conflict (version) do nothing;
