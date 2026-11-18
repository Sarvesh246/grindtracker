-- GRIND Energy: the daily circadian energy schedule (morning peak, afternoon dip,
-- evening peak, wind-down) computed from sleep, felt-energy check-ins that
-- calibrate it, push heads-ups before each phase, and a 5-minute pg_cron job that
-- drives /api/cron/energy (the Vercel crons are hourly, too coarse for this).
-- See docs/ENERGY.md.
--
-- Before the cron job can authenticate, store two Vault secrets ONCE in the SQL
-- editor (never commit them):
--   select vault.create_secret('https://<your-domain>', 'grind_app_url');
--   select vault.create_secret('<same value as CRON_SECRET on Vercel>', 'grind_cron_secret');
begin;

-- ── Schedules: one row per user per local day, written by the service role ──
create table if not exists public.energy_schedules (
  user_id       uuid        not null references auth.users(id) on delete cascade,
  local_date    date        not null,
  timezone      text        not null,
  wake_at       timestamptz not null,
  dlmo_at       timestamptz not null,
  need_min      int         not null check (need_min between 300 and 720),
  debt_min      int         not null check (debt_min >= 0),
  confidence    text        not null check (confidence in ('low','medium','high')),
  provisional   boolean     not null default false,
  model_version int         not null,
  schedule      jsonb       not null,
  -- Newest sleep received_at the schedule was built from; a later import triggers a rebuild.
  sleep_seen_at timestamptz,
  computed_at   timestamptz not null default now(),
  primary key (user_id, local_date)
);

alter table public.energy_schedules enable row level security;
drop policy if exists "own energy schedules" on public.energy_schedules;
create policy "own energy schedules" on public.energy_schedules
  for select using (user_id = auth.uid());
revoke insert, update, delete on public.energy_schedules from anon, authenticated;

-- ── Felt-energy check-ins (tired / ok / sharp) ──────────────────────────────
create table if not exists public.energy_checkins (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  at         timestamptz not null default now(),
  local_date date        not null,
  -- Local clock hour of the tap, e.g. 15.5 for 15:30.
  local_hour real        not null check (local_hour >= 0 and local_hour < 24),
  feeling    smallint    not null check (feeling in (-1, 0, 1)),
  created_at timestamptz not null default now()
);

create index if not exists energy_checkins_user_at_idx on public.energy_checkins (user_id, at desc);

alter table public.energy_checkins enable row level security;
drop policy if exists "own energy checkins select" on public.energy_checkins;
create policy "own energy checkins select" on public.energy_checkins
  for select using (user_id = auth.uid());
drop policy if exists "own energy checkins insert" on public.energy_checkins;
create policy "own energy checkins insert" on public.energy_checkins
  for insert with check (user_id = auth.uid() and at <= now() + interval '5 minutes');
drop policy if exists "own energy checkins delete" on public.energy_checkins;
create policy "own energy checkins delete" on public.energy_checkins
  for delete using (user_id = auth.uid());

-- ── Alert preferences ───────────────────────────────────────────────────────
alter table public.notification_prefs
  add column if not exists energy_alerts boolean not null default false,
  add column if not exists energy_kinds text[] not null
    default array['morning_peak','afternoon_dip','evening_peak','wind_down'],
  add column if not exists energy_lead_min smallint not null default 20;

alter table public.notification_prefs drop constraint if exists notification_prefs_energy_lead_check;
alter table public.notification_prefs add constraint notification_prefs_energy_lead_check
  check (energy_lead_min between 5 and 60);
alter table public.notification_prefs drop constraint if exists notification_prefs_energy_kinds_check;
alter table public.notification_prefs add constraint notification_prefs_energy_kinds_check
  check (energy_kinds <@ array['morning_peak','afternoon_dip','evening_peak','wind_down']);

-- ── New notification kinds ──────────────────────────────────────────────────
alter table public.scheduled_notifications drop constraint if exists scheduled_notifications_kind_check;
alter table public.scheduled_notifications add constraint scheduled_notifications_kind_check
  check (kind in (
    'rest_end', 'rest_warn', 'streak_daily',
    'energy_morning_peak', 'energy_dip', 'energy_evening_peak', 'energy_wind_down'
  ));

commit;

-- ── 5-minute driver (outside the transaction: extensions and cron manage their own) ──
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'grind-energy') then
    perform cron.unschedule('grind-energy');
  end if;
end $$;

select cron.schedule(
  'grind-energy',
  '*/5 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'grind_app_url')
           || '/api/cron/energy',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'grind_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

insert into public.grind_migrations (version) values ('65-energy-schedule') on conflict (version) do nothing;
