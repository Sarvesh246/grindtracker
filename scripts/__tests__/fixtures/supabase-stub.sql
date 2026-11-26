-- Minimal stand-in for the parts of a Supabase project that docs/sql/ assumes
-- already exist: the API roles, auth.uid()/auth.jwt(), auth.users, a storage
-- schema, and the base tables that were created in the dashboard before
-- migrations were tracked (exercises, sessions, session_logs, user_stats,
-- user_badges, user_profiles, friendships).
--
-- Used only by tests that load the real migrations into a THROWAWAY Postgres
-- (see scripts/__tests__/watchApi.db.test.ts). Never run this against a real
-- project. auth.uid() reads the `request.jwt.claim.sub` setting, the same one
-- PostgREST sets, so a test can act as a user with set_config().

do $$ begin
  create role anon nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role nologin bypassrls;
exception when duplicate_object then null; end $$;

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'sub', current_setting('request.jwt.claim.sub', true),
    'email', (select email from auth.users
               where id = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid)
  )
$$;

create table if not exists storage.buckets (
  id text primary key,
  name text,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now()
);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$ select string_to_array(name, '/') $$;

create table if not exists public.user_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text,
  avatar_url text,
  created_at timestamptz default now()
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  day_type text not null,
  sets_target int not null default 3,
  reps_target text not null default '8-12',
  sort_order int not null default 0,
  created_at timestamptz default now()
);

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day_type text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  xp_earned int not null default 0,
  created_at timestamptz default now()
);
alter table public.sessions enable row level security;

create table if not exists public.session_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete cascade,
  set_number int not null,
  weight numeric,
  reps int,
  is_pr boolean not null default false,
  created_at timestamptz default now(),
  unique (session_id, exercise_id, set_number)
);
alter table public.session_logs enable row level security;

create table if not exists public.user_stats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  xp_total int not null default 0,
  level int not null default 1,
  current_streak int not null default 0,
  longest_streak int not null default 0,
  last_workout_date date,
  total_workouts int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.user_stats enable row level security;

create table if not exists public.user_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_id text not null,
  earned_at timestamptz default now(),
  unique (user_id, badge_id)
);
alter table public.user_badges enable row level security;

create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz default now()
);
alter table public.friendships enable row level security;

grant usage on schema public, auth, storage to anon, authenticated, service_role;
grant all on all tables in schema public to authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Base owner-only policies that were also created in the dashboard (the
-- migrations only add to them).
drop policy if exists "stub own sessions" on public.sessions;
create policy "stub own sessions" on public.sessions
  for select using (auth.uid() = user_id);
drop policy if exists "stub own sessions insert" on public.sessions;
create policy "stub own sessions insert" on public.sessions
  for insert with check (auth.uid() = user_id);
drop policy if exists "stub own sessions update" on public.sessions;
create policy "stub own sessions update" on public.sessions
  for update using (auth.uid() = user_id);
drop policy if exists "stub own session logs" on public.session_logs;
create policy "stub own session logs" on public.session_logs
  for all using (exists (select 1 from public.sessions s
                          where s.id = session_id and s.user_id = auth.uid()));
drop policy if exists "stub own stats" on public.user_stats;
create policy "stub own stats" on public.user_stats
  for select using (auth.uid() = user_id);
drop policy if exists "stub own badges" on public.user_badges;
create policy "stub own badges" on public.user_badges
  for select using (auth.uid() = user_id);
drop policy if exists "stub profiles" on public.user_profiles;
alter table public.user_profiles enable row level security;
drop policy if exists profiles_read_all on public.user_profiles;
create policy profiles_read_all on public.user_profiles
  for select to authenticated using (true);
drop policy if exists profiles_write_own on public.user_profiles;
create policy profiles_write_own on public.user_profiles
  for all to authenticated using (auth.uid() = id);
