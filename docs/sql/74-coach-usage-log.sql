-- Phase 74: Coach rate limits count an append-only usage log, not coach_messages
-- Idempotent. Apply BEFORE deploying the code that reads coach_usage.
--
-- Bug: the 15-per-24h and 8-per-10-minutes caps were derived by counting
-- user-role rows in coach_messages. Anything that removes a row from there
-- hands the allowance back, and grind_coach_refund_message() (34) was callable
-- straight through RPC by any signed-in user on any of their own messages from
-- the last 2 minutes: send, call the refund, send again. The cap is also the
-- only thing between the app and Gemini's own quota, which ran out once for
-- everyone.
--
-- Fix: every user turn appends one row to coach_usage inside the BEFORE INSERT
-- trigger on coach_messages (so a direct insert through RLS is charged too).
-- Clients get SELECT on their own rows and nothing else: no insert, update or
-- delete, so deleting or refunding a message can't touch the count.
--
-- Refunds still exist, because a turn the model never answered shouldn't cost
-- the user anything. They are appended too (kind = 'refund', pointing at the
-- use it cancels, at most one per use) and are only reachable by service_role:
-- the chat route calls grind_coach_refund_usage() with the service client after
-- a real server-side failure. The old client-callable function is dropped.
--
-- The admin coach_dev_unlimited bypass from 55 is kept above the lock and the
-- counts. Unlimited turns are still logged (for visibility) but never capped.
-- If enforce_coach_rate_limit() is redefined again, start from THIS file.

create table if not exists public.coach_usage (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null default 'use' check (kind in ('use', 'refund')),
  -- Message that was charged (use rows). Deliberately no FK: deleting the
  -- message must not delete, or be able to reach, its usage row.
  message_id  uuid,
  -- For refund rows: the use row being cancelled.
  refunds_id  bigint references public.coach_usage(id),
  created_at  timestamptz not null default now(),
  constraint coach_usage_refund_shape check (
    (kind = 'use' and refunds_id is null)
    or (kind = 'refund' and refunds_id is not null)
  )
);

create index if not exists coach_usage_user_created_idx
  on public.coach_usage (user_id, created_at desc);
-- One refund per use.
create unique index if not exists coach_usage_one_refund_idx
  on public.coach_usage (refunds_id) where kind = 'refund';

alter table public.coach_usage enable row level security;

drop policy if exists "read own coach usage" on public.coach_usage;
create policy "read own coach usage" on public.coach_usage
  for select using (auth.uid() = user_id);

-- Append-only for every client role: no policy grants a write, and the table
-- privileges are taken away as well so a future policy can't open one by accident.
revoke all on public.coach_usage from public, anon, authenticated;
grant select on public.coach_usage to authenticated;
grant all on public.coach_usage to service_role;

-- Carry the current windows over so limits don't reset on deploy.
insert into public.coach_usage (user_id, kind, message_id, created_at)
select m.user_id, 'use', m.id, m.created_at
  from public.coach_messages m
 where m.role = 'user'
   and m.created_at > now() - interval '24 hours'
   and not exists (select 1 from public.coach_usage u where u.message_id = m.id);

create or replace function public.enforce_coach_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  burst_count integer;
  daily_count integer;
  unlimited   boolean := false;
begin
  if new.role is distinct from 'user' then
    return new;
  end if;

  -- Admin dev toggle: no caps. The column alone grants nothing (the row is
  -- owner-writable), so is_grind_admin() is re-checked here.
  if is_grind_admin() and exists (
    select 1 from user_profiles
     where id = new.user_id and coach_dev_unlimited
  ) then
    unlimited := true;
  end if;

  if not unlimited then
    -- Serialize concurrent inserts for this user so the counts can't be read
    -- by two racing transactions before either one commits (see 44).
    perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

    select count(*) into burst_count
      from coach_usage u
     where u.user_id = new.user_id
       and u.kind = 'use'
       and u.created_at > now() - interval '10 minutes'
       and not exists (select 1 from coach_usage r where r.refunds_id = u.id);

    if burst_count >= 8 then
      raise exception 'COACH_RATE_LIMIT_BURST: more than 8 messages in 10 minutes'
        using errcode = '54000';
    end if;

    select count(*) into daily_count
      from coach_usage u
     where u.user_id = new.user_id
       and u.kind = 'use'
       and u.created_at > now() - interval '24 hours'
       and not exists (select 1 from coach_usage r where r.refunds_id = u.id);

    if daily_count >= 15 then
      raise exception 'COACH_RATE_LIMIT_DAILY: more than 15 messages in 24 hours'
        using errcode = '54000';
    end if;
  end if;

  insert into coach_usage (user_id, kind, message_id)
  values (new.user_id, 'use', new.id);

  return new;
end;
$$;

-- Server-only refund. Cancels the use charged for a message the model never
-- answered, and removes that message like the old function did. Never reachable
-- with a user's JWT, so a client can't refund itself.
create or replace function public.grind_coach_refund_usage(
  p_user_id uuid,
  p_message_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  use_id bigint;
begin
  select u.id into use_id
    from coach_usage u
   where u.user_id = p_user_id
     and u.kind = 'use'
     and u.message_id = p_message_id
     and u.created_at > now() - interval '5 minutes'
   limit 1;

  if use_id is null then
    return;
  end if;

  insert into coach_usage (user_id, kind, refunds_id)
  values (p_user_id, 'refund', use_id)
  on conflict (refunds_id) where kind = 'refund' do nothing;

  delete from coach_messages
   where id = p_message_id
     and user_id = p_user_id
     and role = 'user';
end;
$$;

revoke all on function public.grind_coach_refund_usage(uuid, uuid) from public, anon, authenticated;
grant execute on function public.grind_coach_refund_usage(uuid, uuid) to service_role;

-- The client-callable refund is the hole; it goes.
drop function if exists public.grind_coach_refund_message(uuid);

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('74-coach-usage-log') on conflict (version) do nothing;
