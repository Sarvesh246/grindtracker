-- Apply after the web app uses grind_profile_directory to look up other accounts.
begin;

alter table public.user_profiles enable row level security;
drop policy if exists profiles_read_all on public.user_profiles;
drop policy if exists "profiles read own" on public.user_profiles;
create policy "profiles read own" on public.user_profiles
  for select to authenticated using ((select auth.uid()) = id);

insert into public.grind_migrations (version) values ('86-private-profile-settings') on conflict (version) do nothing;

commit;
