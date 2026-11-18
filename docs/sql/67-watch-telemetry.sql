-- Phase 67: Watch telemetry — richer rep lab recordings and app health
-- Idempotent: safe to re-run. Apply AFTER 66-rep-lab.sql. The watch keeps its
-- records and retries until this exists, and recordings sent before it is
-- applied still store their motion (the new signals are dropped), so order is
-- forgiving, but apply it before relying on POST /api/watch/v1/telemetry.
--
-- Adds:
--   1. rep_lab_sets.mag_x/y/z, hr, beats — the compass at 12.5 Hz, heart rate
--      per second and beat intervals recorded with each set.
--   2. watch_store_rep_lab, replaced to store them.
--   3. watch_telemetry — app health from the watch: runs that never stopped
--      cleanly (crashes) with what the app was doing, and per-workout vitals
--      (battery, peak memory, longest counter step, upload outcomes).
--   4. watch_store_telemetry — service-role only, like the other watch_* RPCs.
--
-- Privacy: owner-only. watch_telemetry rows cascade with the account and are
-- trimmed after 365 days on each upload.

begin;

alter table public.rep_lab_sets add column if not exists mag_x smallint[];
alter table public.rep_lab_sets add column if not exists mag_y smallint[];
alter table public.rep_lab_sets add column if not exists mag_z smallint[];
alter table public.rep_lab_sets add column if not exists hr    smallint[];  -- bpm per sensor batch, 0 = no reading
alter table public.rep_lab_sets add column if not exists beats integer[];   -- ms between heartbeats

create or replace function public.watch_store_rep_lab(p_user uuid, p_set jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid := (p_set->>'id')::uuid;
  v_sid uuid := (p_set->>'session_id')::uuid;
  v_n   int;
begin
  if p_set ? 'x' then
    if not exists (select 1 from public.sessions where id = v_sid and user_id = p_user) then
      raise exception 'WATCH_SESSION_NOT_FOUND' using errcode = '22023';
    end if;
    insert into public.rep_lab_sets as r (
      id, user_id, session_id, exercise_id, exercise_name, set_number, weight, unit,
      logged_reps, auto_reps, auto_shown, typed, corrected, started_at, finished_at,
      rate_hz, clipped, motion_x, motion_y, motion_z, steps, mag_x, mag_y, mag_z, hr, beats,
      events, diag, app_version)
    values (
      v_id, p_user, v_sid, p_set->>'exercise_id', p_set->>'exercise_name',
      (p_set->>'set_number')::smallint, (p_set->>'weight')::numeric(6,1), p_set->>'unit',
      (p_set->>'logged_reps')::smallint, (p_set->>'auto_reps')::smallint,
      coalesce((p_set->>'auto_shown')::boolean, false), coalesce((p_set->>'typed')::boolean, false),
      coalesce((p_set->>'corrected')::boolean, false),
      (p_set->>'started_at')::timestamptz, (p_set->>'finished_at')::timestamptz,
      (p_set->>'rate_hz')::numeric(4,1), coalesce((p_set->>'clipped')::boolean, false),
      (select array_agg(v::smallint order by o) from jsonb_array_elements_text(p_set->'x') with ordinality t(v, o)),
      (select array_agg(v::smallint order by o) from jsonb_array_elements_text(p_set->'y') with ordinality t(v, o)),
      (select array_agg(v::smallint order by o) from jsonb_array_elements_text(p_set->'z') with ordinality t(v, o)),
      (select array_agg(v::int order by o) from jsonb_array_elements_text(coalesce(p_set->'steps', '[]'::jsonb)) with ordinality t(v, o)),
      (select array_agg(v::smallint order by o) from jsonb_array_elements_text(case when jsonb_typeof(p_set->'mag_x') = 'array' then p_set->'mag_x' else '[]'::jsonb end) with ordinality t(v, o)),
      (select array_agg(v::smallint order by o) from jsonb_array_elements_text(case when jsonb_typeof(p_set->'mag_y') = 'array' then p_set->'mag_y' else '[]'::jsonb end) with ordinality t(v, o)),
      (select array_agg(v::smallint order by o) from jsonb_array_elements_text(case when jsonb_typeof(p_set->'mag_z') = 'array' then p_set->'mag_z' else '[]'::jsonb end) with ordinality t(v, o)),
      (select array_agg(v::smallint order by o) from jsonb_array_elements_text(case when jsonb_typeof(p_set->'hr') = 'array' then p_set->'hr' else '[]'::jsonb end) with ordinality t(v, o)),
      (select array_agg(v::int order by o) from jsonb_array_elements_text(case when jsonb_typeof(p_set->'beats') = 'array' then p_set->'beats' else '[]'::jsonb end) with ordinality t(v, o)),
      p_set->'events', p_set->'diag', p_set->>'app_version')
    on conflict (id) do update set
      session_id = excluded.session_id, exercise_id = excluded.exercise_id,
      exercise_name = excluded.exercise_name, set_number = excluded.set_number,
      weight = excluded.weight, unit = excluded.unit,
      -- A correction may have landed first; never undo it.
      logged_reps = case when r.corrected then r.logged_reps else excluded.logged_reps end,
      corrected = r.corrected or excluded.corrected,
      auto_reps = excluded.auto_reps, auto_shown = excluded.auto_shown, typed = excluded.typed,
      started_at = excluded.started_at, finished_at = excluded.finished_at,
      rate_hz = excluded.rate_hz, clipped = excluded.clipped,
      motion_x = excluded.motion_x, motion_y = excluded.motion_y, motion_z = excluded.motion_z,
      steps = excluded.steps, mag_x = excluded.mag_x, mag_y = excluded.mag_y, mag_z = excluded.mag_z,
      hr = excluded.hr, beats = excluded.beats,
      events = excluded.events, diag = excluded.diag,
      app_version = excluded.app_version, updated_at = now()
    where r.user_id = p_user;
    get diagnostics v_n = row_count;
  else
    update public.rep_lab_sets
       set logged_reps = (p_set->>'logged_reps')::smallint, corrected = true, updated_at = now()
     where id = v_id and user_id = p_user;
    get diagnostics v_n = row_count;
  end if;

  delete from public.rep_lab_sets where user_id = p_user and created_at < now() - interval '365 days';

  return json_build_object('id', v_id, 'stored', v_n > 0);
end;
$$;

revoke all on function public.watch_store_rep_lab(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_store_rep_lab(uuid, jsonb) to service_role;

create table if not exists public.watch_telemetry (
  id          uuid primary key,              -- chosen by the watch, so a re-send overwrites itself
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('unclean_exit', 'session')),
  at          timestamptz,                   -- when it happened, by the watch's clock
  app_version text,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists watch_telemetry_user_created on public.watch_telemetry (user_id, created_at desc);

alter table public.watch_telemetry enable row level security;
revoke all on public.watch_telemetry from anon, authenticated;
grant select on public.watch_telemetry to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'watch_telemetry' and policyname = 'watch_telemetry_owner_select') then
    create policy watch_telemetry_owner_select on public.watch_telemetry for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- p_row: { id, kind, at, app_version, data }.
create or replace function public.watch_store_telemetry(p_user uuid, p_row jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := (p_row->>'id')::uuid;
  v_n  int;
begin
  insert into public.watch_telemetry as t (id, user_id, kind, at, app_version, data)
  values (v_id, p_user, p_row->>'kind', (p_row->>'at')::timestamptz, p_row->>'app_version',
          coalesce(p_row->'data', '{}'::jsonb))
  on conflict (id) do update set
    kind = excluded.kind, at = excluded.at, app_version = excluded.app_version, data = excluded.data
  where t.user_id = p_user;
  get diagnostics v_n = row_count;

  delete from public.watch_telemetry where user_id = p_user and created_at < now() - interval '365 days';

  return json_build_object('id', v_id, 'stored', v_n > 0);
end;
$$;

revoke all on function public.watch_store_telemetry(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_store_telemetry(uuid, jsonb) to service_role;

commit;

insert into public.grind_migrations (version) values ('67-watch-telemetry') on conflict (version) do nothing;
