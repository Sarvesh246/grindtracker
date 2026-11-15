-- Phase 00: record which migrations production has actually run.
-- Idempotent: safe to re-run. Apply this FIRST, before any later file.
--
-- WHY THIS EXISTS
-- ---------------
-- Migrations are pasted by hand into the Supabase SQL editor, so nothing
-- recorded what a given project had. Every file from 02 onward now ends with
--   insert into public.grind_migrations (version) values ('NN-name') ...
-- and `npm run migrations:check` lists any file with no matching row.
--
-- The table is RLS-locked with no policies: the app (anon / authenticated)
-- can neither read nor write it. Read it from the SQL editor, or with the
-- service-role key (the check script does the latter).

begin;

create table if not exists public.grind_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);

alter table public.grind_migrations enable row level security;
revoke all on public.grind_migrations from anon, authenticated;

comment on table public.grind_migrations is
  'One row per docs/sql file applied to this project (version = file name without .sql).';

insert into public.grind_migrations (version) values ('00-migration-tracking') on conflict (version) do nothing;

commit;
