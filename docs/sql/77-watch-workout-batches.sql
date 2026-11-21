-- A finished Garmin workout may arrive as several requests. Keep the unfinished
-- upload out of the web logger's open-session slot until its final batch.
create table if not exists grind_private.watch_workout_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  sets jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

create or replace function public.watch_ingest_session(p_user uuid, p_session jsonb)
returns json language plpgsql security definer set search_path = ''
as $$
declare
  v_sid uuid := (p_session->>'id')::uuid;
  v_sets jsonb := coalesce(p_session->'sets', '[]'::jsonb);
  v_prior jsonb;
  v_rejected jsonb;
  v_accepted jsonb;
  v_result json;
begin
  perform pg_advisory_xact_lock(hashtextextended('watch_session:' || v_sid::text, 0));
  select sets into v_prior from grind_private.watch_workout_batches
    where user_id = p_user and session_id = v_sid;
  if p_session->>'ended_at' is not null then
    select coalesce(jsonb_agg(s), '[]'::jsonb) into v_sets
      from (
        select distinct on (s->>'id') s
        from jsonb_array_elements(coalesce(v_prior, '[]'::jsonb) || v_sets) with ordinality as x(s, n)
        order by s->>'id', n desc
      ) merged;
    v_result := public.watch_sync_session(p_user, jsonb_set(p_session, '{sets}', v_sets));
    delete from grind_private.watch_workout_batches where user_id = p_user and session_id = v_sid;
    return v_result;
  end if;
  if exists (select 1 from public.sessions where id = v_sid) then
    return public.watch_sync_session(p_user, p_session);
  end if;

  select
    coalesce(jsonb_agg(s->'id') filter (where e.id is not null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', s->'id', 'code', 'unknown_exercise',
      'message', 'Exercise not found for this account.')) filter (where e.id is null), '[]'::jsonb)
  into v_accepted, v_rejected
  from jsonb_array_elements(v_sets) as x(s)
  left join public.exercises e on e.id = (s->>'exercise_id')::uuid and e.user_id = p_user;

  select coalesce(jsonb_agg(s), '[]'::jsonb) into v_sets
    from (
      select distinct on (s->>'id') s
      from jsonb_array_elements(coalesce(v_prior, '[]'::jsonb) || v_sets) with ordinality as x(s, n)
      where n <= jsonb_array_length(coalesce(v_prior, '[]'::jsonb)) or v_accepted ? (s->>'id')
      order by s->>'id', n desc
    ) merged;
  if jsonb_array_length(v_sets) > 512 then
    raise exception 'WATCH_TOO_MANY_STAGED_SETS' using errcode = '22023';
  end if;
  insert into grind_private.watch_workout_batches (user_id, session_id, sets)
    values (p_user, v_sid, v_sets)
    on conflict (user_id, session_id) do update set sets = excluded.sets, updated_at = now();
  return json_build_object(
    'session', json_build_object('id', v_sid, 'workout_id', p_session->>'workout_id',
      'status', 'staged', 'created', v_prior is null, 'completed_now', false, 'completed_at', null),
    'sets', json_build_object('accepted', v_accepted, 'rejected', v_rejected)
  );
end;
$$;
revoke all on function public.watch_ingest_session(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.watch_ingest_session(uuid, jsonb) to service_role;

insert into public.grind_migrations (version) values ('77-watch-workout-batches') on conflict (version) do nothing;
