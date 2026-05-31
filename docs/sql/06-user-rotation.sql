-- Phase 6: per-user workout rotation (the suggested order of days).
-- Idempotent: safe to re-run.
--
-- `sequence` is an ordered loop of day_keys (matching exercises.day_type), and a
-- day may repeat — e.g. ["push","abs","pull","abs","legs","abs"]. `current_index`
-- points at the slot of the user's last completed workout; the home page suggests
-- the slot after it (wrapping). `mode = 'auto'` means the order is derived from the
-- user's days (each once, alphabetical) and `sequence` is ignored; `'manual'` means
-- the stored `sequence` is the source of truth.

create table if not exists user_rotation (
  user_id       uuid    not null references auth.users(id) on delete cascade,
  mode          text    not null default 'auto' check (mode in ('auto','manual')),
  sequence      jsonb   not null default '[]'::jsonb,
  current_index int     not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id)
);

alter table user_rotation enable row level security;

drop policy if exists "own rotation" on user_rotation;
create policy "own rotation"
  on user_rotation for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
