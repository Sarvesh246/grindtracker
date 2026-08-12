-- Phase 35: Coach saved conversations (tracked copy of docs/sql/35-coach-conversations.sql)
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

-- ── Backfill pre-35 orphans ────────────────────────────────────────────────
-- Messages logged before this migration have conversation_id null. Group them
-- into threads per user with a 45-minute idle gap (matches "new chat" intent
-- better than dumping everything into one row). Safe to re-run: only touches
-- null conversation_id rows.

do $$
declare
  r record;
  cur_user uuid := null;
  cur_conv uuid := null;
  last_at timestamptz := null;
  titled boolean := false;
  next_title text;
begin
  for r in
    select id, user_id, role, content, created_at
      from coach_messages
     where conversation_id is null
     order by user_id, created_at, id
  loop
    if cur_user is distinct from r.user_id
       or last_at is null
       or r.created_at > last_at + interval '45 minutes' then
      next_title := 'Earlier chat';
      titled := false;
      if r.role = 'user' then
        next_title := regexp_replace(btrim(r.content), '\s+', ' ', 'g');
        if next_title = '' then
          next_title := 'Earlier chat';
        elsif char_length(next_title) > 48 then
          next_title := left(next_title, 47) || '…';
        end if;
        titled := true;
      end if;

      insert into coach_conversations (user_id, title, created_at, updated_at)
      values (r.user_id, next_title, r.created_at, r.created_at)
      returning id into cur_conv;

      cur_user := r.user_id;
    elsif not titled and r.role = 'user' then
      next_title := regexp_replace(btrim(r.content), '\s+', ' ', 'g');
      if next_title = '' then
        next_title := 'Earlier chat';
      elsif char_length(next_title) > 48 then
        next_title := left(next_title, 47) || '…';
      end if;
      update coach_conversations
         set title = next_title
       where id = cur_conv;
      titled := true;
    end if;

    update coach_messages
       set conversation_id = cur_conv
     where id = r.id;

    update coach_conversations
       set updated_at = r.created_at
     where id = cur_conv;

    last_at := r.created_at;
  end loop;
end $$;
