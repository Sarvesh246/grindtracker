-- Health import sources: Garmin data export, Apple Health (iPhone Shortcut) and an
-- owner-run Garmin sync script. They reuse the revision-aware sleep ingestion from
-- migration 61; this adds the source names, one internal importer and two entry
-- points (signed-in web, and a device token for the Shortcut/script).
-- No credentials are stored: the script logs in to Garmin on the owner's machine.
begin;

alter table public.health_connections drop constraint if exists health_connections_source_check;
alter table public.health_connections add constraint health_connections_source_check
  check (source in ('connect_iq','garmin_personal','garmin_business','garmin_export','garmin_unofficial','apple_health'));

-- Internal: validates the source, honours pause/delete generations, makes sure a
-- connection row exists, then hands the batch to the existing ingestion.
create or replace function public.health_import_batch(p_user uuid, p_source text, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare g integer; on_ boolean; conn uuid;
begin
  if p_source not in ('garmin_export','garmin_unofficial','apple_health') then
    raise exception 'HEALTH_IMPORT_SOURCE';
  end if;
  if pg_column_size(p_batch) > 600000 then raise exception 'HEALTH_IMPORT_TOO_LARGE'; end if;
  if jsonb_array_length(coalesce(p_batch->'samples','[]'::jsonb)) <> 0 then
    raise exception 'HEALTH_IMPORT_SAMPLES';
  end if;
  insert into public.health_collection(user_id) values (p_user) on conflict (user_id) do nothing;
  select enabled, generation into on_, g from public.health_collection where user_id = p_user;
  if not on_ then raise exception 'HEALTH_COLLECTION_PAUSED'; end if;
  insert into public.health_connections(user_id, source, device_id, status)
  values (p_user, p_source, 'import', 'active')
  on conflict (user_id, source, device_id) do update
    set status = case when public.health_connections.status = 'revoked' then 'revoked' else 'active' end
  returning id into conn;
  if (select status from public.health_connections where id = conn) = 'revoked' then
    raise exception 'HEALTH_CONNECTION_UNAVAILABLE';
  end if;
  return public.health_ingest_batch(
    p_user, conn,
    jsonb_set(jsonb_set(p_batch, '{source}', to_jsonb(p_source)), '{generation}', to_jsonb(g))
  );
end $$;
revoke all on function public.health_import_batch(uuid,text,jsonb) from public, anon, authenticated;

-- Signed-in web: Settings → Garmin data export.
create or replace function public.import_health_batch(p_source text, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return public.health_import_batch(uid, p_source, p_batch);
end $$;
revoke all on function public.import_health_batch(text,jsonb) from public, anon;
grant execute on function public.import_health_batch(text,jsonb) to authenticated;

-- Device token (service role): the Apple Health Shortcut and the Garmin sync script.
create or replace function public.token_import_health_batch(p_user uuid, p_device uuid, p_source text, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists(select 1 from public.watch_devices where id = p_device and user_id = p_user and revoked_at is null) then
    raise exception 'HEALTH_DEVICE_UNAVAILABLE';
  end if;
  return public.health_import_batch(p_user, p_source, p_batch);
end $$;
revoke all on function public.token_import_health_batch(uuid,uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.token_import_health_batch(uuid,uuid,text,jsonb) to service_role;

commit;
insert into public.grind_migrations (version) values ('64-health-import-sources') on conflict (version) do nothing;
