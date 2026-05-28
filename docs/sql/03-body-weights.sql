-- Phase 3 schema: body weight tracking.
-- Apply via Supabase SQL editor.
-- Idempotent: safe to re-run.

create table if not exists body_weights (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  weight numeric not null check (weight > 0),
  recorded_at date not null,
  created_at timestamptz not null default now(),
  unique (user_id, recorded_at)
);

alter table body_weights enable row level security;

drop policy if exists "own body weights" on body_weights;
create policy "own body weights"
  on body_weights
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists body_weights_user_date_idx
  on body_weights (user_id, recorded_at desc);
