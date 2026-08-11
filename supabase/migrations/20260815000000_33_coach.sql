-- Phase 33: GRIND Coach message log + rate limits (Gemini-backed chat)
-- Source of truth: docs/sql/33-coach.sql

create table if not exists coach_messages (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  role       text        not null
                         check (role in ('user', 'assistant')),
  content    text        not null
                         check (char_length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists coach_messages_user_created_idx
  on coach_messages (user_id, created_at desc);

create index if not exists coach_messages_user_role_created_idx
  on coach_messages (user_id, role, created_at desc);

alter table coach_messages enable row level security;

drop policy if exists "insert own coach messages" on coach_messages;
create policy "insert own coach messages"
  on coach_messages for insert
  with check (auth.uid() = user_id);

drop policy if exists "read own coach messages" on coach_messages;
create policy "read own coach messages"
  on coach_messages for select
  using (auth.uid() = user_id);

create or replace function enforce_coach_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  burst_count integer;
  daily_count integer;
begin
  if new.role is distinct from 'user' then
    return new;
  end if;

  select count(*) into burst_count
    from coach_messages
   where user_id = new.user_id
     and role = 'user'
     and created_at > now() - interval '10 minutes';

  if burst_count >= 8 then
    raise exception 'COACH_RATE_LIMIT_BURST: more than 8 messages in 10 minutes'
      using errcode = '54000';
  end if;

  select count(*) into daily_count
    from coach_messages
   where user_id = new.user_id
     and role = 'user'
     and created_at > now() - interval '24 hours';

  if daily_count >= 15 then
    raise exception 'COACH_RATE_LIMIT_DAILY: more than 15 messages in 24 hours'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists coach_rate_limit on coach_messages;
create trigger coach_rate_limit
  before insert on coach_messages
  for each row execute function enforce_coach_rate_limit();
