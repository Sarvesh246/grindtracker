-- Phase 68: Morning readiness checks, lifting load on the watch, per-exercise rep tuning
-- Idempotent: safe to re-run. Apply AFTER 67-watch-telemetry.sql, and BEFORE
-- deploying the code that calls watch_store_readiness / watch_rep_tuning.
--
-- Adds:
--   1. readiness_checks — one row per 1-minute seated HRV check on the watch:
--      the raw beat-to-beat intervals, and RMSSD, mean HR and quality as the
--      server computed them (src/lib/body/hrv.ts). Feeds Charge and the Coach.
--      Refused while health collection is switched off; wiped by
--      delete_body_data / delete_my_grind_data (delete_health_history).
--   2. watch_store_readiness — service-role only, like the other watch_* RPCs.
--   3. rep_tuning — per user and exercise, counter settings tuned on that
--      user's own rep lab sets by the nightly job (src/lib/reps/tuning.ts),
--      with the cross-validated evidence for the change. Owner reads; only
--      the service role writes.
--   4. watch_rep_tuning — the tunings /today hands the watch, for the current
--      counter algorithm only; rep_tuning_candidates — the nightly job's count
--      of usable sets per exercise.
--   5. watch_body_context, replaced: adds readiness checks and the working
--      sets lifting load needs, so the watch's Charge matches the web's.

begin;

-- ── 1. readiness_checks ────────────────────────────────────────────────────

create table if not exists public.readiness_checks (
  id            uuid primary key,                 -- chosen by the watch
  user_id       uuid not null references auth.users (id) on delete cascade,
  local_date    date not null,
  measured_at   timestamptz not null,
  duration_s    smallint not null check (duration_s between 10 and 600),
  rr_ms         integer[] not null,               -- beat-to-beat intervals as the watch delivered them
  moving_s      smallint not null default 0,      -- seconds the watch saw the wrist move
  rmssd         numeric(5,1),                     -- server-computed; null when there was nothing clean
  ln_rmssd      numeric(5,3),
  mean_hr       numeric(4,1),
  sdnn          numeric(5,1),
  clean_beats   smallint not null default 0,
  artifact_pct  numeric(4,1) not null default 0,
  quality       text not null check (quality in ('good', 'fair', 'poor')),
  watch_rmssd   numeric(5,1),                     -- what the watch showed, to keep the two in step
  app_version   text,
  created_at    timestamptz not null default now()
);

create index if not exists readiness_checks_user_date on public.readiness_checks (user_id, local_date desc);

alter table public.readiness_checks enable row level security;
revoke all on public.readiness_checks from anon, authenticated;
grant select on public.readiness_checks to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'readiness_checks' and policyname = 'readiness_checks_owner_select') then
    create policy readiness_checks_owner_select on public.readiness_checks for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ── 2. watch_store_readiness ──────────────────────────────────────────────

-- p_check: { id, local_date, measured_at, duration_s, rr_ms, moving_s, rmssd,
--   ln_rmssd, mean_hr, sdnn, clean_beats, artifact_pct, quality, watch_rmssd,
--   app_version }, the numbers already computed by the route.
create or replace function public.watch_store_readiness(p_user uuid, p_check jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (p_check->>'id')::uuid;
  v_n  int;
begin
  -- Same lock and switch as every other health write (migration 61).
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  if exists (select 1 from public.health_collection where user_id = p_user and not enabled) then
    return json_build_object('id', v_id, 'stored', false, 'reason', 'collection_off');
  end if;

  insert into public.readiness_checks as r (
    id, user_id, local_date, measured_at, duration_s, rr_ms, moving_s, rmssd, ln_rmssd, mean_hr,
    sdnn, clean_beats, artifact_pct, quality, watch_rmssd, app_version)
  values (
    v_id, p_user, (p_check->>'local_date')::date, (p_check->>'measured_at')::timestamptz,
    (p_check->>'duration_s')::smallint,
    (select array_agg(v::int order by o) from jsonb_array_elements_text(p_check->'rr_ms') with ordinality t(v, o)),
    coalesce((p_check->>'moving_s')::smallint, 0),
    (p_check->>'rmssd')::numeric, (p_check->>'ln_rmssd')::numeric, (p_check->>'mean_hr')::numeric,
    (p_check->>'sdnn')::numeric, coalesce((p_check->>'clean_beats')::smallint, 0),
    coalesce((p_check->>'artifact_pct')::numeric, 0), p_check->>'quality',
    (p_check->>'watch_rmssd')::numeric, p_check->>'app_version')
  on conflict (id) do update set
    local_date = excluded.local_date, measured_at = excluded.measured_at, duration_s = excluded.duration_s,
    rr_ms = excluded.rr_ms, moving_s = excluded.moving_s, rmssd = excluded.rmssd, ln_rmssd = excluded.ln_rmssd,
    mean_hr = excluded.mean_hr, sdnn = excluded.sdnn, clean_beats = excluded.clean_beats,
    artifact_pct = excluded.artifact_pct, quality = excluded.quality, watch_rmssd = excluded.watch_rmssd,
    app_version = excluded.app_version
  where r.user_id = p_user;
  get diagnostics v_n = row_count;

  delete from public.readiness_checks where user_id = p_user and local_date < current_date - 400;

  return json_build_object('id', v_id, 'stored', v_n > 0);
end;
$$;

revoke all on function public.watch_store_readiness(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_store_readiness(uuid, jsonb) to service_role;

-- Deleting health data takes the checks with it.
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
end $$;
revoke all on function public.delete_health_history() from public, anon, authenticated;

-- ── 3. rep_tuning ─────────────────────────────────────────────────────────

create table if not exists public.rep_tuning (
  user_id        uuid not null references auth.users (id) on delete cascade,
  exercise_id    text not null,
  algo_version   text not null,                -- tools/reps.mjs ALGO_VERSION the tuning was made for
  params         jsonb not null,               -- { ac, cv, swing, lag }; {} = defaults won
  sets_used      smallint not null,
  default_exact  smallint not null,            -- cross-validated, on held-out sets
  default_wrong  smallint not null,
  tuned_exact    smallint not null,
  tuned_wrong    smallint not null,
  applied        boolean not null,             -- false: tuned but not better enough, defaults stay
  tuned_at       timestamptz not null default now(),
  primary key (user_id, exercise_id)
);

alter table public.rep_tuning enable row level security;
revoke all on public.rep_tuning from anon, authenticated;
grant select on public.rep_tuning to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rep_tuning' and policyname = 'rep_tuning_owner_select') then
    create policy rep_tuning_owner_select on public.rep_tuning for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- ── 4. watch_rep_tuning ───────────────────────────────────────────────────

create or replace function public.watch_rep_tuning(p_user uuid, p_algo text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(json_agg(json_build_object('exercise_id', t.exercise_id, 'params', t.params)), '[]'::json)
    from public.rep_tuning t
   where t.user_id = p_user and t.algo_version = p_algo and t.applied;
$$;

revoke all on function public.watch_rep_tuning(uuid, text) from public, anon, authenticated;
grant execute on function public.watch_rep_tuning(uuid, text) to service_role;

-- The nightly job's light pass: usable labelled sets per user and exercise
-- (the same rule as tools/tune.mjs eligible()), without moving any motion.
create or replace function public.rep_tuning_candidates(p_since timestamptz)
returns table (user_id uuid, exercise_id text, n int)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, r.exercise_id, count(*)::int
    from public.rep_lab_sets r
   where r.created_at >= p_since
     and r.exercise_id is not null
     and array_length(r.motion_x, 1) >= 48
     and array_length(r.motion_y, 1) = array_length(r.motion_x, 1)
     and array_length(r.motion_z, 1) = array_length(r.motion_x, 1)
     and r.logged_reps between 1 and 100
     and coalesce((r.diag->>'interrupted')::boolean, false) = false
   group by r.user_id, r.exercise_id;
$$;

revoke all on function public.rep_tuning_candidates(timestamptz) from public, anon, authenticated;
grant execute on function public.rep_tuning_candidates(timestamptz) to service_role;

-- ── 5. watch_body_context, with readiness and lifting sets ───────────────

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
    'prefs', (select json_build_object('coach_uses_body', p.coach_uses_body, 'smart_rest', p.smart_rest)
                from public.body_prefs p where p.user_id = p_user)
  );
$$;

revoke all on function public.watch_body_context(uuid, date) from public, anon, authenticated;
grant execute on function public.watch_body_context(uuid, date) to service_role;

commit;

insert into public.grind_migrations (version) values ('68-readiness-and-tuning') on conflict (version) do nothing;
