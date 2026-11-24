-- 84-fitness-age.sql
--
-- Fitness age (docs/FITNESS-AGE-RESEARCH.md) needs two things GRIND never
-- stored:
--   1. fitness_profile: birth date, sex and height. Every reference curve
--      (VO2max, grip, HRV) is age- and sex-specific, and Garmin's own profile
--      is not synced.
--   2. fitness_calibrations: the anchors that pin down the wearable's personal
--      bias: a maximal 5 km or Cooper run, a lab CPET, a grip-dynamometer
--      reading. Auto-detected 5 km efforts are computed on read; a row with
--      source = 'auto' only exists to remember that the user rejected (or
--      confirmed) one, keyed by the Garmin activity id.
--
-- Both are owner-only. Neither feeds XP, streaks, PRs or the leaderboard, so a
-- client-written value only ever moves the caller's own fitness age.

create table if not exists public.fitness_profile (
  user_id uuid primary key references auth.users(id) on delete cascade,
  birth_date date not null check (birth_date between date '1900-01-01' and date '2100-01-01'),
  sex text not null check (sex in ('male', 'female')),
  height_cm numeric check (height_cm between 100 and 250),
  updated_at timestamptz not null default now()
);

create table if not exists public.fitness_calibrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on date not null,
  kind text not null check (kind in ('run_5k', 'cooper', 'lab_cpet', 'grip')),
  -- run_5k / cooper / lab_cpet: VO2max in mL/kg/min; grip: best squeeze in kg.
  value numeric not null,
  raw jsonb not null default '{}',
  source text not null default 'manual' check (source in ('manual', 'auto')),
  activity_id text,
  status text not null default 'accepted' check (status in ('accepted', 'rejected')),
  created_at timestamptz not null default now(),
  check (
    (kind = 'grip' and value between 5 and 100)
    or (kind <> 'grip' and value between 10 and 100)
  ),
  check (source = 'manual' or activity_id is not null)
);

-- Not partial: PostgREST upserts can't name a partial index's predicate, and
-- NULLs are distinct anyway, so manual rows never collide.
create unique index if not exists fitness_calibrations_activity
  on public.fitness_calibrations(user_id, activity_id);
create index if not exists fitness_calibrations_by_owner
  on public.fitness_calibrations(user_id, measured_on desc);

do $$
declare tbl text;
begin
  foreach tbl in array array['fitness_profile', 'fitness_calibrations'] loop
    execute format('alter table public.%I enable row level security', tbl);
    execute format('revoke all on public.%I from public, anon', tbl);
    execute format('grant select, insert, update, delete on public.%I to authenticated', tbl);
    execute format('drop policy if exists fitness_owner_all on public.%I', tbl);
    execute format(
      'create policy fitness_owner_all on public.%I for all to authenticated '
      'using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', tbl);
  end loop;
end $$;

insert into public.grind_migrations (version) values ('84-fitness-age') on conflict (version) do nothing;
