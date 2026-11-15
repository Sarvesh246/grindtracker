-- 32 — First-run setup wizard gate
-- Idempotent. Apply after 31.
--
-- `setup_completed_at` null means the user must finish /setup before the app
-- shell. Completing the wizard stamps now(); Profile → Replay Setup nulls it
-- again. Existing rows stay null so every current account gets one forced pass
-- after deploy (alongside the proxy cookie semantic change).

alter table public.user_profiles
  add column if not exists setup_completed_at timestamptz null;

comment on column public.user_profiles.setup_completed_at is
  'When the first-run setup wizard finished. Null = redirect to /setup.';

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('32-setup-completed') on conflict (version) do nothing;
