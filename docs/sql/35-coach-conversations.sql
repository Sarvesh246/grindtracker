-- Phase 35: Coach saved conversations (Siri-app-style history)
-- Idempotent: safe to re-run.
--
-- Groups coach_messages into per-user chat threads. Rate limits still count
-- every user-role row across all conversations (see enforce_coach_rate_limit).
-- Apply after 33-coach.sql + 34-coach-quota-fixes.sql.

-- ── Conversations ──────────────────────────────────────────────────────────

create table if not exists coach_conversations (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  title      text        not null default 'New chat'
                         check (char_length(btrim(title)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coach_conversations_user_updated_idx
  on coach_conversations (user_id, updated_at desc);

alter table coach_conversations enable row level security;

drop policy if exists "select own coach conversations" on coach_conversations;
create policy "select own coach conversations"
  on coach_conversations for select
  using (auth.uid() = user_id);

drop policy if exists "insert own coach conversations" on coach_conversations;
create policy "insert own coach conversations"
  on coach_conversations for insert
  with check (auth.uid() = user_id);

drop policy if exists "update own coach conversations" on coach_conversations;
create policy "update own coach conversations"
  on coach_conversations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "delete own coach conversations" on coach_conversations;
create policy "delete own coach conversations"
  on coach_conversations for delete
  using (auth.uid() = user_id);

-- ── Link messages → conversations ──────────────────────────────────────────

alter table coach_messages
  add column if not exists conversation_id uuid
    references coach_conversations(id) on delete cascade;

create index if not exists coach_messages_conversation_created_idx
  on coach_messages (conversation_id, created_at asc);

-- Allow owners to delete message rows only via conversation cascade / RPC
-- (still no direct client DELETE policy on coach_messages).

-- ── Delete a conversation (messages cascade) ───────────────────────────────

create or replace function grind_coach_delete_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from coach_conversations
   where id = p_conversation_id
     and user_id = auth.uid();
end;
$$;

revoke all on function grind_coach_delete_conversation(uuid) from public;
grant execute on function grind_coach_delete_conversation(uuid) to authenticated;
