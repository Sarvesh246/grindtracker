-- Claim oldest-due Energy refreshes in small leases so overlapping cron runs
-- and the invocation budget cannot starve users at the end of the list.
alter table public.notification_prefs
  add column if not exists energy_refresh_due_at timestamptz not null default now(),
  add column if not exists energy_refresh_lease_until timestamptz,
  add column if not exists energy_refresh_last_ok_at timestamptz;
create index if not exists notification_prefs_energy_due_idx
  on public.notification_prefs (energy_refresh_due_at, user_id)
  where enabled and energy_alerts;

create or replace function public.claim_energy_refreshes(p_limit integer)
returns table (user_id uuid, timezone text, energy_kinds text[], energy_lead_min integer, lease_until timestamptz)
language sql security invoker set search_path = ''
as $$
  with due as (
    select np.user_id from public.notification_prefs np
    where np.enabled and np.energy_alerts
      and np.energy_refresh_due_at <= now()
      and coalesce(np.energy_refresh_lease_until, '-infinity'::timestamptz) <= now()
    order by np.energy_refresh_due_at, np.user_id
    for update skip locked
    limit greatest(0, least(coalesce(p_limit, 0), 32))
  )
  update public.notification_prefs np
    set energy_refresh_lease_until = now() + interval '2 minutes'
    from due where np.user_id = due.user_id
    returning np.user_id, np.timezone, np.energy_kinds, np.energy_lead_min::integer, np.energy_refresh_lease_until;
$$;
revoke all on function public.claim_energy_refreshes(integer) from public, anon, authenticated;
grant execute on function public.claim_energy_refreshes(integer) to service_role;

create or replace function public.settle_energy_refresh(p_user uuid, p_lease timestamptz, p_success boolean)
returns void language sql security invoker set search_path = ''
as $$
  update public.notification_prefs
     set energy_refresh_due_at = now() + case when p_success then interval '4 minutes' else interval '10 minutes' end,
         energy_refresh_lease_until = null,
         energy_refresh_last_ok_at = case when p_success then now() else energy_refresh_last_ok_at end
   where user_id = p_user and energy_refresh_lease_until = p_lease;
$$;
revoke all on function public.settle_energy_refresh(uuid, timestamptz, boolean) from public, anon, authenticated;
grant execute on function public.settle_energy_refresh(uuid, timestamptz, boolean) to service_role;

insert into public.grind_migrations (version) values ('79-energy-refresh-leases') on conflict (version) do nothing;
