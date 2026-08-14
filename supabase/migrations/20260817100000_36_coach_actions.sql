-- Phase 36: Coach action proposals (confirm-before-apply mutations)
-- (tracked copy of docs/sql/36-coach-actions.sql)
-- Idempotent: safe to re-run.
--
-- Stores pending Coach tool proposals so the model can only preview changes.
-- The user confirms/cancels in the Coach UI; /api/coach/actions executes.
-- RLS: owner-only select/insert/update. No deletes from the client.

create table if not exists coach_action_proposals (
  id               uuid        primary key default gen_random_uuid(),
  user_id          uuid        not null references auth.users(id) on delete cascade,
  conversation_id  uuid        null references coach_conversations(id) on delete set null,
  kind             text        not null
                               check (kind in (
                                 'correct_weights',
                                 'start_workout',
                                 'create_day'
                               )),
  payload          jsonb       not null default '{}'::jsonb,
  status           text        not null default 'pending'
                               check (status in (
                                 'pending',
                                 'confirmed',
                                 'cancelled',
                                 'executed',
                                 'failed'
                               )),
  result           jsonb       null,
  expires_at       timestamptz not null default (now() + interval '30 minutes'),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists coach_action_proposals_user_created_idx
  on coach_action_proposals (user_id, created_at desc);

create index if not exists coach_action_proposals_user_status_idx
  on coach_action_proposals (user_id, status, expires_at);

alter table coach_action_proposals enable row level security;

drop policy if exists "select own coach action proposals" on coach_action_proposals;
create policy "select own coach action proposals"
  on coach_action_proposals for select
  using (auth.uid() = user_id);

drop policy if exists "insert own coach action proposals" on coach_action_proposals;
create policy "insert own coach action proposals"
  on coach_action_proposals for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own coach action proposals" on coach_action_proposals;
create policy "update own coach action proposals"
  on coach_action_proposals for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Keep updated_at fresh on status transitions.
create or replace function grind_touch_coach_action_proposal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists coach_action_proposals_touch on coach_action_proposals;
create trigger coach_action_proposals_touch
  before update on coach_action_proposals
  for each row execute function grind_touch_coach_action_proposal();
