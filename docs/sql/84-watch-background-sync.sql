-- A saved workout is immutable on the watch. Accept retries without rewriting
-- a completed workout that the user may already have edited on the phone.
create or replace function public.watch_ingest_saved_session(
  p_user uuid, p_session jsonb, p_expected_count integer default null
)
returns json language plpgsql security definer set search_path = ''
as $$
declare
  v_sid uuid := (p_session->>'id')::uuid;
  v_rows jsonb := coalesce(p_session->'sets', '[]'::jsonb);
  v_session public.sessions%rowtype;
  v_prior jsonb;
  v_duplicates jsonb;
  v_rejected jsonb;
  v_result json;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('watch_session:' || v_sid::text, 0));
  select * into v_session from public.sessions where id = v_sid for update;
  if found and v_session.user_id is distinct from p_user then
    raise exception 'WATCH_SESSION_ID_CONFLICT' using errcode = '42501';
  end if;

  if v_session.completed_at is not null then
    select
      coalesce(jsonb_agg(item->'id') filter (where log.id is not null), '[]'::jsonb),
      coalesce(jsonb_agg(jsonb_build_object('id', item->'id', 'code', 'set_removed',
        'message', 'This set is no longer part of the completed workout.'))
        filter (where log.id is null), '[]'::jsonb)
    into v_duplicates, v_rejected
    from jsonb_array_elements(v_rows) as incoming(item)
    left join public.session_logs log on log.session_id = v_sid and log.id = (item->>'id')::uuid;

    return json_build_object(
      'session', json_build_object('id', v_sid, 'workout_id', v_session.day_type,
        'created', false, 'status', 'completed', 'completed_now', false,
        'completed_at', v_session.completed_at, 'xp_earned', v_session.xp_earned),
      'sets', json_build_object('duplicate', v_duplicates, 'rejected', v_rejected),
      'stats', (select json_build_object('current_streak', current_streak)
                from public.user_stats where user_id = p_user)
    );
  end if;

  -- A background final packet can arrive after its earlier batches went
  -- missing. Require the complete set list under the same ingest lock.
  if p_expected_count is not null then
    select sets into v_prior from grind_private.watch_workout_batches
      where user_id = p_user and session_id = v_sid;
    if (select count(distinct item->>'id') from jsonb_array_elements(coalesce(v_prior, '[]'::jsonb) || v_rows) as sets(item))
        <> p_expected_count then
      raise exception 'WATCH_INCOMPLETE_BATCH' using errcode = '22023';
    end if;
  end if;

  v_result := public.watch_ingest_session(p_user, p_session);
  if p_expected_count is not null and json_array_length(v_result->'sets'->'rejected') > 0 then
    raise exception 'WATCH_SAVED_SET_REFUSED' using errcode = '22023';
  end if;
  return v_result;
end;
$$;
revoke all on function public.watch_ingest_saved_session(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.watch_ingest_saved_session(uuid, jsonb, integer) to service_role;

insert into public.grind_migrations (version) values ('84-watch-background-sync') on conflict (version) do nothing;
