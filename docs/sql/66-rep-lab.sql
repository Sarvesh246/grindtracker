-- Phase 66: Rep lab — real-world recordings for tuning the watch rep counter
-- Idempotent: safe to re-run. Apply AFTER 65-energy-schedule.sql. The watch
-- keeps its recordings and retries until this exists, so order is forgiving,
-- but apply it before relying on POST /api/watch/v1/rep-lab.
--
-- Adds:
--   1. rep_lab_sets — one row per set logged on the watch with Rep lab on:
--      the wrist-motion window the counter analyzed (12.5 Hz, milli-g), what
--      the counter offered and when, what was logged, and later corrections.
--      Display-free: nothing reads it for XP, streaks, PRs or the leaderboard.
--   2. watch_store_rep_lab — service-role only, like the other watch_* RPCs
--      (the route derives p_user from the device token).
--
-- Privacy: owner-only. Rows reference their workout session with ON DELETE
-- CASCADE, so deleting a workout, wiping GRIND data or deleting the account
-- removes them. Recordings older than 365 days are trimmed on each upload.

begin;

create table if not exists public.rep_lab_sets (
  id            uuid primary key,             -- the set's id (session_logs.id)
  user_id       uuid not null references auth.users (id) on delete cascade,
  session_id    uuid not null references public.sessions (id) on delete cascade,
  exercise_id   text,
  exercise_name text,
  set_number    smallint,
  weight        numeric(6,1),
  unit          text,
  logged_reps   smallint not null,
  auto_reps     smallint,                     -- the counter's confident count at finish, null = none
  auto_shown    boolean not null default false, -- the logged number was the AUTO number on screen
  typed         boolean not null default false, -- reps were changed by hand during the set
  corrected     boolean not null default false, -- changed later through Undo
  started_at    timestamptz,
  finished_at   timestamptz,
  rate_hz       numeric(4,1),                 -- sample rate of the motion arrays
  clipped       boolean not null default false, -- the 75 s rolling window dropped the start
  motion_x      smallint[],
  motion_y      smallint[],
  motion_z      smallint[],
  steps         integer[],                    -- step counter deltas per sample
  events        jsonb,                        -- counter timeline, see docs/watch-api.md
  diag          jsonb,                        -- sensor and analysis diagnostics
  app_version   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists rep_lab_sets_user_created on public.rep_lab_sets (user_id, created_at desc);

alter table public.rep_lab_sets enable row level security;
revoke all on public.rep_lab_sets from anon, authenticated;
grant select on public.rep_lab_sets to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'rep_lab_sets' and policyname = 'rep_lab_sets_owner_select') then
    create policy rep_lab_sets_owner_select on public.rep_lab_sets for select to authenticated using (user_id = auth.uid());
  end if;
end $$;

-- p_set: a full recording { id, session_id, exercise_id, exercise_name,
--   set_number, weight, unit, logged_reps, auto_reps, auto_shown, typed,
--   started_at, finished_at, rate_hz, clipped, x, y, z, steps, events, diag,
--   app_version }, or a correction { id, logged_reps, corrected: true }.
-- Idempotent: a re-sent recording overwrites itself.
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
      rate_hz, clipped, motion_x, motion_y, motion_z, steps, events, diag, app_version)
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
      steps = excluded.steps, events = excluded.events, diag = excluded.diag,
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

commit;

insert into public.grind_migrations (version) values ('66-rep-lab') on conflict (version) do nothing;
