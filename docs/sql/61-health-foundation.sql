-- Health foundation. Canonical migration lives here, as required by docs/SQL.md.
-- No provider credentials, raw health payloads, or automatic cloud enrollment.
begin;

create table if not exists public.health_collection (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  generation integer not null default 0 check (generation >= 0)
);
create table if not exists public.health_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('connect_iq','garmin_personal','garmin_business')),
  device_id text not null,
  generation integer not null default 0,
  capabilities jsonb not null default '{}',
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active','paused','revoked','error')),
  last_success_at timestamptz,
  last_error_code text,
  sync_cursor text,
  unique(user_id, source, device_id), unique(id, user_id)
);
create table if not exists public.health_ingest_batches (
  user_id uuid not null,
  connection_id uuid not null,
  batch_id uuid not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  payload_version integer not null check (payload_version = 1),
  payload_hash text not null,
  outcome text not null default 'processed',
  primary key(connection_id, batch_id),
  foreign key(connection_id, user_id) references public.health_connections(id, user_id) on delete cascade
);
create table if not exists public.health_samples (
  user_id uuid not null,
  connection_id uuid not null,
  provider_id text not null,
  metric text not null check (metric in ('heart_rate','body_battery','stress','steps','resting_hr','hrv','respiration','spo2','recovery_hours')),
  start_at timestamptz not null,
  end_at timestamptz not null,
  observed_at timestamptz not null,
  revision_at timestamptz not null,
  received_at timestamptz not null default now(),
  value numeric,
  unit text not null,
  kind text not null check (kind in ('point','average','total')),
  quality text not null check (quality in ('current','partial','unavailable')),
  check (end_at >= start_at),
  check (value is null or case metric
    when 'heart_rate' then unit = 'bpm' and value between 20 and 250
    when 'resting_hr' then unit = 'bpm' and value between 20 and 150
    when 'body_battery' then unit = 'score' and value between 0 and 100
    when 'stress' then unit = 'score' and value between 0 and 100
    when 'steps' then unit = 'steps' and value between 0 and 200000
    when 'hrv' then unit = 'ms' and value between 1 and 500
    when 'respiration' then unit = 'breaths/min' and value between 1 and 80
    when 'spo2' then unit = 'percent' and value between 50 and 100
    when 'recovery_hours' then unit = 'hours' and value between 0 and 200 else false end),
  primary key(connection_id, metric, provider_id),
  foreign key(connection_id, user_id) references public.health_connections(id, user_id) on delete cascade
);
create index if not exists health_samples_owner_metric_time on public.health_samples(user_id, metric, start_at);
create table if not exists public.sleep_sessions (
  user_id uuid not null,
  connection_id uuid not null,
  provider_id text not null,
  source text not null,
  device_id text not null,
  wake_date date not null,
  provider_date date not null,
  timezone text not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  kind text not null check (kind in ('main','nap')),
  duration_seconds integer not null check (duration_seconds between 0 and 86400),
  score numeric check (score between 0 and 100),
  stages jsonb,
  stage_totals jsonb,
  overnight_hrv numeric check (overnight_hrv between 1 and 500),
  respiration numeric check (respiration between 1 and 80),
  spo2 numeric check (spo2 between 50 and 100),
  revision_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null check (status in ('final','provisional','unknown')),
  check (end_at > start_at and end_at - start_at <= interval '24 hours'),
  check (duration_seconds <= extract(epoch from end_at - start_at)),
  primary key(connection_id, provider_id),
  foreign key(connection_id, user_id) references public.health_connections(id, user_id) on delete cascade
);
create index if not exists sleep_sessions_owner_wake on public.sleep_sessions(user_id, wake_date);
create table if not exists public.health_daily_summaries (
  user_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null, timezone text not null,
  evidence jsonb not null, coverage jsonb not null, provenance jsonb not null,
  interpretation_version text not null, updated_at timestamptz not null default now(),
  primary key(user_id, local_date, timezone)
);
create table if not exists public.health_insights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start timestamptz not null, period_end timestamptz not null,
  evidence jsonb not null, interpretation_version text not null,
  consent_generation integer not null, explanation text,
  expires_at timestamptz not null
);
create index if not exists health_batches_owner_received on public.health_ingest_batches(user_id,received_at);
create index if not exists health_insights_owner_expiry on public.health_insights(user_id,expires_at);

-- Exposed tables: owner-only reads; all ingestion is privileged and validated.
do $$ declare t text; begin
  foreach t in array array['health_collection','health_connections','health_ingest_batches','health_samples','sleep_sessions','health_daily_summaries','health_insights'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
    execute format('drop policy if exists health_owner_read on public.%I', t);
    execute format('create policy health_owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)', t);
  end loop;
end $$;

create or replace function public.set_health_collection(p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 61));
  insert into public.health_collection(user_id, enabled, generation) values(uid, p_enabled, 1)
    on conflict(user_id) do update set enabled = excluded.enabled, generation = health_collection.generation + 1;
  update public.health_connections set status = case when p_enabled and status <> 'revoked' then 'active' when status = 'revoked' then 'revoked' else 'paused' end, generation = generation + 1 where user_id = uid;
  delete from public.health_insights where user_id = uid;
end $$;
revoke all on function public.set_health_collection(boolean) from public, anon;
grant execute on function public.set_health_collection(boolean) to authenticated;

create or replace function public.health_ingest_batch(p_user uuid, p_connection uuid, p_batch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.health_connections; s jsonb; prior text; fingerprint text; accepted integer := 0; g integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  select * into c from public.health_connections where id = p_connection and user_id = p_user for update;
  if not found or c.status <> 'active' or c.source <> p_batch->>'source' then raise exception 'HEALTH_CONNECTION_UNAVAILABLE'; end if;
  select generation into g from public.health_collection where user_id = p_user and enabled;
  if not found or g <> (p_batch->>'generation')::integer then raise exception 'HEALTH_COLLECTION_CHANGED'; end if;
  if (p_batch->>'version')::integer <> 1 or jsonb_array_length(p_batch->'samples') > 256 or jsonb_array_length(p_batch->'sleeps') > 14 then raise exception 'HEALTH_INVALID_BATCH'; end if;
  fingerprint := encode(sha256(convert_to(p_batch::text, 'UTF8')), 'hex');
  select payload_hash into prior from public.health_ingest_batches where connection_id = p_connection and batch_id = (p_batch->>'batch_id')::uuid;
  if found then
    if prior <> fingerprint then raise exception 'HEALTH_BATCH_CONFLICT'; end if;
    return jsonb_build_object('acknowledged', p_batch->>'batch_id', 'duplicate', true);
  end if;
  for s in select value from jsonb_array_elements(p_batch->'samples') loop
    if (s->>'start_at')::timestamptz < now() - interval '180 days' or (s->>'end_at')::timestamptz > now() + interval '5 minutes' then raise exception 'HEALTH_TIME_RANGE'; end if;
    insert into public.health_samples(user_id,connection_id,provider_id,metric,start_at,end_at,observed_at,revision_at,value,unit,kind,quality)
    values(p_user,p_connection,s->>'provider_id',s->>'metric',(s->>'start_at')::timestamptz,(s->>'end_at')::timestamptz,(s->>'observed_at')::timestamptz,(s->>'revision_at')::timestamptz,(s->>'value')::numeric,s->>'unit',s->>'kind',s->>'quality')
    on conflict(connection_id,metric,provider_id) do update set start_at=excluded.start_at,end_at=excluded.end_at,observed_at=excluded.observed_at,revision_at=excluded.revision_at,value=excluded.value,unit=excluded.unit,kind=excluded.kind,quality=excluded.quality,received_at=now()
    where excluded.revision_at > health_samples.revision_at;
    accepted := accepted + 1;
  end loop;
  for s in select value from jsonb_array_elements(p_batch->'sleeps') loop
    if c.source = 'connect_iq' then raise exception 'HEALTH_SLEEP_SOURCE'; end if;
    if (s->>'start_at')::timestamptz < now() - interval '180 days' or (s->>'end_at')::timestamptz > now() + interval '5 minutes' then raise exception 'HEALTH_TIME_RANGE'; end if;
    if ((s->>'end_at')::timestamptz at time zone (s->>'timezone'))::date <> (s->>'wake_date')::date then raise exception 'HEALTH_WAKE_DATE'; end if;
    insert into public.sleep_sessions(user_id,connection_id,provider_id,source,device_id,wake_date,provider_date,timezone,start_at,end_at,kind,duration_seconds,score,stages,stage_totals,overnight_hrv,respiration,spo2,revision_at,status)
    values(p_user,p_connection,s->>'provider_id',c.source,c.device_id,(s->>'wake_date')::date,(s->>'provider_date')::date,s->>'timezone',(s->>'start_at')::timestamptz,(s->>'end_at')::timestamptz,s->>'kind',(s->>'duration_seconds')::integer,(s->>'score')::numeric,nullif(s->'stages','null'::jsonb),nullif(s->'stage_totals','null'::jsonb),(s->>'overnight_hrv')::numeric,(s->>'respiration')::numeric,(s->>'spo2')::numeric,(s->>'revision_at')::timestamptz,s->>'status')
    on conflict(connection_id,provider_id) do update set wake_date=excluded.wake_date,provider_date=excluded.provider_date,timezone=excluded.timezone,start_at=excluded.start_at,end_at=excluded.end_at,kind=excluded.kind,duration_seconds=excluded.duration_seconds,score=excluded.score,stages=excluded.stages,stage_totals=excluded.stage_totals,overnight_hrv=excluded.overnight_hrv,respiration=excluded.respiration,spo2=excluded.spo2,revision_at=excluded.revision_at,status=excluded.status,received_at=now()
    where excluded.revision_at > sleep_sessions.revision_at;
  end loop;
  insert into public.health_ingest_batches(user_id,connection_id,batch_id,captured_at,payload_version,payload_hash) values(p_user,p_connection,(p_batch->>'batch_id')::uuid,(p_batch->>'captured_at')::timestamptz,1,fingerprint);
  update public.health_connections set last_success_at=now(),last_error_code=null where id=p_connection;
  delete from public.health_daily_summaries where user_id=p_user;
  delete from public.health_insights where user_id=p_user;
  -- Bounded rolling diagnostic/sample retention. Sleep/daily history is retained.
  delete from public.health_samples where user_id=p_user and end_at < now() - interval '180 days';
  delete from public.health_ingest_batches where user_id=p_user and received_at < now() - interval '30 days';
  return jsonb_build_object('acknowledged',p_batch->>'batch_id','duplicate',false,'sample_count',accepted);
end $$;
revoke all on function public.health_ingest_batch(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.health_ingest_batch(uuid,uuid,jsonb) to service_role;

create or replace function public.watch_health_context(p_user uuid,p_device uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.watch_devices where id=p_device and user_id=p_user and revoked_at is null) then raise exception 'HEALTH_DEVICE_UNAVAILABLE'; end if;
  select jsonb_build_object('enabled',enabled,'generation',generation) into result from public.health_collection where user_id=p_user;
  return coalesce(result,jsonb_build_object('enabled',true,'generation',0));
end $$;
revoke all on function public.watch_health_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.watch_health_context(uuid,uuid) to service_role;

create or replace function public.watch_ingest_health_batch(p_user uuid,p_device uuid,p_batch jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare connection uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text,61));
  perform public.watch_health_context(p_user,p_device);
  if p_batch->>'source' <> 'connect_iq' or jsonb_array_length(p_batch->'sleeps') <> 0 then raise exception 'HEALTH_WATCH_SOURCE'; end if;
  insert into public.health_collection(user_id) values(p_user) on conflict do nothing;
  insert into public.health_connections(user_id,source,device_id) values(p_user,'connect_iq',p_device::text) on conflict(user_id,source,device_id) do nothing;
  select id into connection from public.health_connections where user_id=p_user and source='connect_iq' and device_id=p_device::text;
  return public.health_ingest_batch(p_user,connection,p_batch);
end $$;
revoke all on function public.watch_ingest_health_batch(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.watch_ingest_health_batch(uuid,uuid,jsonb) to service_role;

-- Preserve the complete existing workout deletion implementation, then extend it.
do $$ begin
  if to_regprocedure('public.delete_body_data_before_health()') is null then alter function public.delete_body_data() rename to delete_body_data_before_health; end if;
  if to_regprocedure('public.delete_my_grind_data_before_health()') is null then alter function public.delete_my_grind_data() rename to delete_my_grind_data_before_health; end if;
end $$;
revoke all on function public.delete_body_data_before_health() from public,anon,authenticated;
revoke all on function public.delete_my_grind_data_before_health() from public,anon,authenticated;
create or replace function public.delete_health_history()
returns void language plpgsql security definer set search_path=public as $$
declare uid uuid:=auth.uid();
begin
  if uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform public.set_health_collection(false);
  delete from public.health_connections where user_id=uid;
  delete from public.health_daily_summaries where user_id=uid;
  delete from public.health_insights where user_id=uid;
end $$;
revoke all on function public.delete_health_history() from public,anon,authenticated;
create or replace function public.delete_body_data()
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.delete_health_history();
  perform public.delete_body_data_before_health();
end $$;
revoke all on function public.delete_body_data() from public,anon;
grant execute on function public.delete_body_data() to authenticated;
create or replace function public.delete_my_grind_data()
returns void language plpgsql security definer set search_path=public as $$
begin
  perform public.delete_health_history();
  perform public.delete_my_grind_data_before_health();
end $$;
revoke all on function public.delete_my_grind_data() from public,anon;
grant execute on function public.delete_my_grind_data() to authenticated;

-- Old watch daily uploads must not recreate data after deletion. The same lock
-- serializes collection changes/deletion with legacy writes and health batches.
create or replace function public.health_guard_legacy_daily()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text,61));
  if exists(select 1 from public.health_collection where user_id=new.user_id and not enabled) then return null; end if;
  return new;
end $$;
revoke all on function public.health_guard_legacy_daily() from public,anon,authenticated;
drop trigger if exists health_collection_gate on public.daily_body;
create trigger health_collection_gate before insert or update on public.daily_body for each row execute function public.health_guard_legacy_daily();

create or replace function public.health_guard_workout_physiology()
returns trigger language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
  if tg_table_name='sessions' then uid:=new.user_id;
  else select user_id into uid from public.sessions where id=new.session_id; end if;
  perform pg_advisory_xact_lock(hashtextextended(uid::text,61));
  if exists(select 1 from public.health_collection where user_id=uid and not enabled) then
    if tg_table_name='sessions' then
      new.hr_trace:=null; new.hr_step:=null; new.hr_zones:=null; new.zone_seconds:=null; new.training_effect:=null;
      new.avg_heart_rate:=null; new.max_heart_rate:=null; new.calories:=null;
    else new.hr_peak:=null; new.hr_end:=null; new.hr_rest_drop_60:=null;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.health_guard_workout_physiology() from public,anon,authenticated;
drop trigger if exists health_physiology_gate on public.sessions;
create trigger health_physiology_gate before insert or update on public.sessions for each row execute function public.health_guard_workout_physiology();
drop trigger if exists health_physiology_gate on public.session_logs;
create trigger health_physiology_gate before insert or update on public.session_logs for each row execute function public.health_guard_workout_physiology();

-- Opt-out invalidates stored explanations, including any future generated briefs.
create or replace function public.health_invalidate_explanations()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if not new.coach_uses_body then delete from public.health_insights where user_id=new.user_id; end if;
  return new;
end $$;
revoke all on function public.health_invalidate_explanations() from public,anon,authenticated;
drop trigger if exists health_explanation_consent on public.body_prefs;
create trigger health_explanation_consent after insert or update on public.body_prefs for each row execute function public.health_invalidate_explanations();

commit;
insert into public.grind_migrations (version) values ('61-health-foundation') on conflict (version) do nothing;
