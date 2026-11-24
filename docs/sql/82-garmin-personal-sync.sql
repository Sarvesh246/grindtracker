-- Garmin Personal carries no credentials in Postgres. All writes run through the
-- service role, under the same per-owner transaction lock as health deletion.
begin;

create table if not exists public.garmin_personal_sync (
  connection_id uuid primary key,
  user_id uuid not null,
  enabled boolean not null default false,
  push_enabled boolean not null default false,
  scopes text[] not null default '{}'
    check (scopes <@ array['food','cycle','gps']),
  time_zone text not null,
  capabilities jsonb not null default '{}',
  due_at timestamptz not null default now(),
  lease_id uuid,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  failures integer not null default 0,
  backfill_date date,
  backfill_end date,
  last_reconciled_date date,
  foreign key (connection_id, user_id) references public.health_connections(id, user_id) on delete cascade
);

create table if not exists public.garmin_personal_days (
  connection_id uuid not null,
  user_id uuid not null,
  local_date date not null,
  fetched_at timestamptz not null,
  measurements jsonb not null,
  food jsonb,
  cycle jsonb,
  primary key (connection_id, local_date),
  foreign key (connection_id, user_id) references public.health_connections(id, user_id) on delete cascade
);

create table if not exists public.garmin_personal_activities (
  connection_id uuid not null,
  user_id uuid not null,
  provider_id text not null,
  local_date date not null,
  started_at timestamptz not null,
  ended_at timestamptz not null check (ended_at > started_at),
  activity_type text not null,
  name text not null,
  fetched_at timestamptz not null,
  details jsonb not null,
  route jsonb,
  matched_session_id uuid references public.sessions(id) on delete set null,
  manual_match boolean not null default false,
  match_status text not null default 'unmatched'
    check (match_status in ('matched','review','unmatched')),
  primary key (connection_id, provider_id),
  foreign key (connection_id, user_id) references public.health_connections(id, user_id) on delete cascade
);
alter table public.garmin_personal_sync add column if not exists push_enabled boolean not null default false;
alter table public.garmin_personal_activities add column if not exists manual_match boolean not null default false;

create index if not exists garmin_personal_activity_by_owner
  on public.garmin_personal_activities(user_id, local_date desc);
create index if not exists garmin_personal_activity_pending
  on public.garmin_personal_activities(connection_id, started_at desc)
  where details->>'file_checked' is null;
create unique index if not exists garmin_personal_matched_session
  on public.garmin_personal_activities(connection_id, matched_session_id)
  where matched_session_id is not null;

create table if not exists public.garmin_personal_mornings (
  connection_id uuid not null,
  user_id uuid not null,
  local_date date not null,
  first_evaluated_at timestamptz not null default now(),
  first_flagged_at timestamptz,
  latest_status text not null check (latest_status in ('learning','clear','mild')),
  latest_evaluated_at timestamptz not null default now(),
  primary key (connection_id, local_date),
  foreign key (connection_id, user_id) references public.health_connections(id, user_id) on delete cascade
);

create table if not exists public.garmin_personal_push_episodes (
  connection_id uuid not null references public.garmin_personal_sync(connection_id) on delete cascade,
  episode_date date not null,
  claimed_at timestamptz not null default now(),
  primary key (connection_id, episode_date)
);
alter table public.garmin_personal_push_episodes enable row level security;
revoke all on public.garmin_personal_push_episodes from public, anon, authenticated;
grant select, insert, delete on public.garmin_personal_push_episodes to service_role;

alter table public.body_signal_labels add column if not exists symptoms_onset_at timestamptz;

do $$
declare tbl text;
begin
  foreach tbl in array array['garmin_personal_sync','garmin_personal_days','garmin_personal_activities','garmin_personal_mornings'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from public, anon, authenticated', tbl);
    execute format('grant select, insert, update, delete on public.%I to service_role', tbl);
    if tbl <> 'garmin_personal_sync' then
      execute format('grant select on public.%I to authenticated', tbl);
      execute format('drop policy if exists garmin_owner_read on public.%I', tbl);
      execute format(
        'create policy garmin_owner_read on public.%I for select to authenticated using ((select auth.uid()) = user_id)', tbl);
    end if;
  end loop;
end $$;

create or replace function public.garmin_personal_configure(
  p_user uuid, p_action text, p_zone text default null, p_capabilities jsonb default '{}',
  p_scopes text[] default null
) returns void language plpgsql security invoker set search_path = '' as $$
declare conn uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  select id into conn from public.health_connections
    where user_id = p_user and source = 'garmin_personal' and device_id = 'personal';

  if p_action = 'enable' then
    if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_zone) then
      raise exception 'GARMIN_TIME_ZONE';
    end if;
    insert into public.health_collection (user_id) values (p_user) on conflict do nothing;
    if not exists (select 1 from public.health_collection where user_id = p_user and enabled) then
      raise exception 'HEALTH_COLLECTION_PAUSED';
    end if;
    insert into public.health_connections (user_id, source, device_id, status)
      values (p_user, 'garmin_personal', 'personal', 'active')
      on conflict (user_id, source, device_id) do update set status = 'active'
      returning id into conn;
    update public.scheduled_notifications set cancelled_at = now()
      where user_id = p_user and kind = 'body_signal' and sent_at is null and cancelled_at is null;
    insert into public.garmin_personal_sync (connection_id, user_id, enabled, time_zone, capabilities)
      values (conn, p_user, true, p_zone, p_capabilities)
      on conflict (connection_id) do update set enabled = true, time_zone = excluded.time_zone,
        capabilities = excluded.capabilities, due_at = now(), last_error = null,
        lease_id = null, lease_until = null, failures = 0;
  elsif p_action in ('pause', 'disconnect') then
    update public.garmin_personal_sync
      set enabled = false, lease_id = null, lease_until = null,
        push_enabled = case when p_action = 'disconnect' then false else push_enabled end,
        scopes = case when p_action = 'disconnect' then '{}'::text[] else scopes end
      where connection_id = conn;
    update public.health_connections
      set status = case when p_action = 'disconnect' then 'revoked' else 'paused' end
      where id = conn;
  elsif p_action in ('push_on', 'push_off') then
    update public.garmin_personal_sync set push_enabled = (p_action = 'push_on')
      where connection_id = conn and enabled;
  elsif p_action = 'scopes' then
    update public.garmin_personal_sync
      set scopes = p_scopes, lease_id = null, lease_until = null, due_at = now(),
        backfill_date = null, backfill_end = null
      where connection_id = conn and enabled and scopes is distinct from p_scopes;
    if found and 'gps' = any(p_scopes) then
      update public.garmin_personal_activities set details = details - 'file_checked'
      where connection_id = conn and route is null;
    end if;
  else
    raise exception 'GARMIN_ACTION';
  end if;
end $$;

create or replace function public.garmin_personal_claim(p_user uuid, p_manual boolean)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare job public.garmin_personal_sync; g integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  select generation into g from public.health_collection where user_id = p_user and enabled;
  if not found then return null; end if;
  update public.garmin_personal_sync s
    set lease_id = gen_random_uuid(), lease_until = now() + interval '90 seconds', last_attempt_at = now()
    from public.health_connections c
    where s.user_id = p_user and s.connection_id = c.id and s.enabled and c.status = 'active'
      and (s.lease_until is null or s.lease_until <= now())
      and s.last_error is distinct from 'credentials'
      and (s.due_at <= now() or (p_manual and s.failures = 0
        and (s.last_attempt_at is null or s.last_attempt_at < now() - interval '30 seconds')))
    returning s.* into job;
  if not found then return null; end if;
  return to_jsonb(job) || jsonb_build_object('generation', g);
end $$;

create or replace function public.garmin_personal_finish(
  p_user uuid, p_lease uuid, p_generation integer, p_batch jsonb, p_days jsonb, p_activities jsonb,
  p_zone text, p_backfill_date date, p_backfill_end date, p_reconciled date,
  p_error text, p_due_at timestamptz
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare job public.garmin_personal_sync; b jsonb; d jsonb; a jsonb; match uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  select s.* into job from public.garmin_personal_sync s
    join public.health_connections c on c.id = s.connection_id
    join public.health_collection h on h.user_id = s.user_id
    where s.user_id = p_user and s.enabled and s.lease_id = p_lease and s.lease_until > now()
      and c.status = 'active' and h.enabled and h.generation = p_generation;
  if not found then return false; end if;

  if p_error is not null then
    update public.garmin_personal_sync set lease_id = null, lease_until = null,
      due_at = p_due_at, last_error = p_error, failures = least(failures + 1, 10)
      where connection_id = job.connection_id;
    return true;
  end if;

  if pg_column_size(p_days) > 250000 or pg_column_size(p_activities) > 2000000 then
    raise exception 'GARMIN_BATCH_TOO_LARGE';
  end if;
  if jsonb_array_length(p_batch) > 12 then raise exception 'GARMIN_BATCH_TOO_LARGE'; end if;
  for b in select value from jsonb_array_elements(p_batch) loop
    perform public.health_ingest_batch(p_user, job.connection_id, b);
  end loop;
  for d in select value from jsonb_array_elements(p_days) loop
    insert into public.garmin_personal_days
      (connection_id, user_id, local_date, fetched_at, measurements, food, cycle)
      values (job.connection_id, p_user, (d->>'date')::date, now(), d->'measurements',
        case when 'food' = any(job.scopes) then nullif(d->'food','null'::jsonb) end,
        case when 'cycle' = any(job.scopes) then nullif(d->'cycle','null'::jsonb) end)
      on conflict (connection_id, local_date) do update set fetched_at = now(),
        measurements = garmin_personal_days.measurements || excluded.measurements,
        food = case when 'food' = any(job.scopes) then coalesce(excluded.food, garmin_personal_days.food) end,
        cycle = case when 'cycle' = any(job.scopes) then coalesce(excluded.cycle, garmin_personal_days.cycle) end;
  end loop;
  for a in select value from jsonb_array_elements(p_activities) loop
    match := null;
    select id into match from public.sessions where user_id = p_user
      and id = (a->>'matched_session_id')::uuid and completed_at is not null
      and not exists (
        select 1 from public.garmin_personal_activities other
        where other.connection_id = job.connection_id and other.matched_session_id = sessions.id
          and other.provider_id <> a->>'id'
      );
    insert into public.garmin_personal_activities
      (connection_id, user_id, provider_id, local_date, started_at, ended_at, activity_type, name,
        fetched_at, details, route, matched_session_id, match_status)
      values (job.connection_id, p_user, a->>'id', (a->>'date')::date, (a->>'started_at')::timestamptz,
        (a->>'ended_at')::timestamptz, a->>'type', a->>'name', now(), a->'details',
        case when 'gps' = any(job.scopes) then nullif(a->'route','null'::jsonb) end, match,
        case when match is not null then 'matched' when a->>'match_status' = 'unmatched' then 'unmatched' else 'review' end)
      on conflict (connection_id, provider_id) do update set fetched_at = now(),
        local_date = excluded.local_date, started_at = excluded.started_at, ended_at = excluded.ended_at,
        name = excluded.name, activity_type = excluded.activity_type,
        details = garmin_personal_activities.details || excluded.details,
        route = case when 'gps' = any(job.scopes) then coalesce(excluded.route, garmin_personal_activities.route) end,
        matched_session_id = case when garmin_personal_activities.manual_match
          then garmin_personal_activities.matched_session_id else excluded.matched_session_id end,
        match_status = case when garmin_personal_activities.manual_match
          then garmin_personal_activities.match_status else excluded.match_status end;
  end loop;
  update public.garmin_personal_sync set lease_id = null, lease_until = null, time_zone = p_zone,
    due_at = p_due_at, last_error = null, failures = 0, last_success_at = now(),
    backfill_date = p_backfill_date, backfill_end = p_backfill_end, last_reconciled_date = p_reconciled
    where connection_id = job.connection_id;
  return true;
end $$;

revoke all on function public.garmin_personal_configure(uuid,text,text,jsonb,text[]),
  public.garmin_personal_claim(uuid,boolean),
  public.garmin_personal_finish(uuid,uuid,integer,jsonb,jsonb,jsonb,text,date,date,date,text,timestamptz)
  from public, anon, authenticated;
grant execute on function public.garmin_personal_configure(uuid,text,text,jsonb,text[]),
  public.garmin_personal_claim(uuid,boolean),
  public.garmin_personal_finish(uuid,uuid,integer,jsonb,jsonb,jsonb,text,date,date,date,text,timestamptz)
  to service_role;

-- Dropping an opt-in immediately removes just that optional dataset.
create or replace function public.garmin_personal_drop_scopes()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if 'food' = any(old.scopes) and not 'food' = any(new.scopes) then
    update public.garmin_personal_days set food = null where connection_id = new.connection_id and food is not null;
  end if;
  if 'cycle' = any(old.scopes) and not 'cycle' = any(new.scopes) then
    update public.garmin_personal_days set cycle = null where connection_id = new.connection_id and cycle is not null;
  end if;
  if 'gps' = any(old.scopes) and not 'gps' = any(new.scopes) then
    update public.garmin_personal_activities set route = null where connection_id = new.connection_id and route is not null;
  end if;
  return new;
end $$;
drop trigger if exists garmin_personal_drop_scopes on public.garmin_personal_sync;
create trigger garmin_personal_drop_scopes after update of scopes on public.garmin_personal_sync
  for each row when (old.scopes is distinct from new.scopes)
  execute function public.garmin_personal_drop_scopes();

create or replace function public.garmin_personal_link(p_user uuid, p_id text, p_session uuid)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare a public.garmin_personal_activities;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  select * into a from public.garmin_personal_activities where user_id = p_user and provider_id = p_id;
  if not found or a.activity_type not in ('strength_training','strength','resistance_training') then return false; end if;
  if p_session is not null and (
    not exists (select 1 from public.sessions where user_id = p_user and id = p_session
      and local_date = a.local_date and completed_at is not null)
    or exists (select 1 from public.garmin_personal_activities where connection_id = a.connection_id
      and provider_id <> p_id and matched_session_id = p_session)
  ) then return false; end if;
  update public.garmin_personal_activities set manual_match = true, matched_session_id = p_session,
    match_status = case when p_session is null then 'unmatched' else 'matched' end
    where user_id = p_user and provider_id = p_id;
  return found;
end $$;
revoke all on function public.garmin_personal_link(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.garmin_personal_link(uuid,text,uuid) to service_role;

-- The pilot uses in-app findings. Suppress the old watch-triggered push for
-- this connected account, while retaining the existing behavior for others.
create or replace function public.watch_queue_body_signal(p_user uuid, p_local_date date, p_payload jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  if exists (select 1 from public.garmin_personal_sync where user_id = p_user and enabled)
    or exists (select 1 from public.notification_prefs where user_id = p_user and body_signal_alerts = false)
  then return false; end if;
  insert into public.scheduled_notifications (user_id, kind, fire_at, payload, dedupe_key)
    values (p_user, 'body_signal', now(), coalesce(p_payload, '{}'::jsonb),
      'body_signal:' || p_user::text || ':' || p_local_date::text)
    on conflict (dedupe_key) do nothing;
  return found;
end $$;
revoke all on function public.watch_queue_body_signal(uuid,date,jsonb) from public, anon, authenticated;
grant execute on function public.watch_queue_body_signal(uuid,date,jsonb) to service_role;

create or replace function public.garmin_personal_record_morning(
  p_user uuid, p_date date, p_level text, p_sync_at timestamptz
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare conn uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  select s.connection_id into conn from public.garmin_personal_sync s
    join public.health_collection h on h.user_id = s.user_id
    where s.user_id = p_user and s.enabled and h.enabled
      and s.last_success_at = p_sync_at and (now() at time zone s.time_zone)::date = p_date;
  if not found then return false; end if;
  insert into public.garmin_personal_mornings
    (connection_id,user_id,local_date,first_flagged_at,latest_status)
    values (conn,p_user,p_date,case when p_level = 'mild' then now() end,p_level)
    on conflict (connection_id,local_date) do update set
      first_flagged_at = coalesce(garmin_personal_mornings.first_flagged_at,excluded.first_flagged_at),
      latest_status = excluded.latest_status, latest_evaluated_at = now();
  return true;
end $$;
revoke all on function public.garmin_personal_record_morning(uuid,date,text,timestamptz) from public, anon, authenticated;
grant execute on function public.garmin_personal_record_morning(uuid,date,text,timestamptz) to service_role;

create or replace function public.garmin_personal_claim_push(p_user uuid, p_today date, p_episode date)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare conn uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 61));
  select s.connection_id into conn from public.garmin_personal_sync s
    join public.health_collection h on h.user_id = s.user_id
    join public.notification_prefs n on n.user_id = s.user_id
    where s.user_id = p_user and s.enabled and s.push_enabled and h.enabled and n.enabled
      and s.last_success_at > now() - interval '40 minutes'
      and (now() at time zone s.time_zone)::date = p_today
      and (now() at time zone s.time_zone)::time >= '08:00'::time
      and (now() at time zone s.time_zone)::time < '20:00'::time
      and p_episode between p_today - 27 and p_today
      and exists (select 1 from public.push_subscriptions p where p.user_id = p_user);
  if not found then return false; end if;
  insert into public.garmin_personal_push_episodes(connection_id, episode_date)
    values (conn, p_episode) on conflict do nothing;
  return found;
end $$;
revoke all on function public.garmin_personal_claim_push(uuid,date,date) from public, anon, authenticated;
grant execute on function public.garmin_personal_claim_push(uuid,date,date) to service_role;

commit;

select cron.schedule('grind-garmin-personal', '*/5 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'grind_app_url') || '/api/cron/garmin-personal',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'grind_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
$job$);

insert into public.grind_migrations (version) values ('82-garmin-personal-sync') on conflict do nothing;
