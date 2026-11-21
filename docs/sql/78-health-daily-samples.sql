-- One usable sample per source, metric and local day. Dense streams no longer
-- displace a different source, metric or the oldest days in the trend.
create index if not exists health_samples_owner_metric_end
  on public.health_samples (user_id, metric, end_at);

create or replace function public.health_daily_samples(p_date date, p_timezone text)
returns jsonb language sql stable security invoker set search_path = ''
as $$
  with zone as (
    select coalesce((select name from pg_catalog.pg_timezone_names where name = p_timezone), 'UTC') as name
  ), per_day as (
    select s.metric, s.provider_id, s.start_at, s.end_at, s.observed_at, s.revision_at,
      s.value, s.unit, s.kind, s.quality, c.source, (s.end_at at time zone z.name)::date as local_date, s.connection_id
    from public.health_samples s
    join public.health_connections c on c.id = s.connection_id and c.user_id = s.user_id
    cross join zone z
    where s.user_id = (select auth.uid()) and s.value is not null and s.quality <> 'unavailable'
      and s.end_at >= ((p_date - 89)::timestamp at time zone z.name)
      and s.end_at < ((p_date + 1)::timestamp at time zone z.name)
      and s.metric in ('resting_hr', 'hrv', 'spo2', 'steps', 'recovery_hours', 'body_battery', 'stress')
  ), ranked as (
    select distinct on (local_date, source, metric) *
    from per_day
    order by local_date, source, metric, (quality = 'current') desc, end_at desc, revision_at desc, connection_id, provider_id
  )
  select coalesce(jsonb_agg(to_jsonb(r) - 'connection_id' order by local_date, source, metric), '[]'::jsonb)
  from ranked r;
$$;
revoke all on function public.health_daily_samples(date, text) from public, anon;
grant execute on function public.health_daily_samples(date, text) to authenticated;

insert into public.grind_migrations (version) values ('78-health-daily-samples') on conflict (version) do nothing;
