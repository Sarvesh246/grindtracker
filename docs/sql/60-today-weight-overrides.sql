-- Phase 60: today-only weight overrides (Coach "lighter weights today")
-- Idempotent: safe to re-run. Apply AFTER 59-body-data.sql, and BEFORE
-- deploying the app that reads sessions.weight_overrides.
--
-- The Coach's propose_adjust_today can take a percent off today's working
-- weights. That must change what the workout screen prefills WITHOUT touching
-- exercises.weight_target (the saved plan) and without inventing logged sets.
-- So the open session carries its own map: exercise id → weight in canonical
-- lbs. ActiveWorkout prefers it over weight_target / last weight for sets not
-- yet logged. It dies with the session: a finished or discarded workout never
-- affects the next one.
--
-- Clients may not UPDATE arbitrary sessions columns (migration 11 grants only
-- day_type, started_at, note), so the write goes through an RPC that checks
-- the caller owns the session and that it is still open.

begin;

alter table public.sessions add column if not exists weight_overrides jsonb;

create or replace function public.set_session_weight_overrides(p_session_id uuid, p_overrides jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text;
  v_val jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_overrides is null or jsonb_typeof(p_overrides) <> 'object' then
    raise exception 'OVERRIDES_MUST_BE_OBJECT' using errcode = '22023';
  end if;
  -- Every key an exercise of the caller's, every value a sane weight.
  for v_key, v_val in select * from jsonb_each(p_overrides) loop
    if jsonb_typeof(v_val) <> 'number' or (v_val::text)::numeric < 0 or (v_val::text)::numeric > 2000 then
      raise exception 'OVERRIDE_WEIGHT_OUT_OF_RANGE' using errcode = '22023';
    end if;
    if not exists (select 1 from public.exercises e where e.id::text = v_key and e.user_id = v_uid) then
      raise exception 'OVERRIDE_UNKNOWN_EXERCISE' using errcode = '22023';
    end if;
  end loop;

  update public.sessions
     set weight_overrides = coalesce(weight_overrides, '{}'::jsonb) || p_overrides
   where id = p_session_id
     and user_id = v_uid
     and completed_at is null;
  if not found then
    raise exception 'SESSION_NOT_OPEN' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_session_weight_overrides(uuid, jsonb) from public, anon;
grant execute on function public.set_session_weight_overrides(uuid, jsonb) to authenticated;

commit;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('60-today-weight-overrides') on conflict (version) do nothing;
