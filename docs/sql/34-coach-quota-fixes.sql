-- Phase 34: Coach quota fixes
-- Idempotent: safe to re-run.
--
-- 1. Refund a user's rate-limit slot when the Coach model call fails outright
--    (see src/app/api/coach/chat/route.ts) — a turn the user never actually
--    got a reply to shouldn't burn their daily/burst allowance. Tightly
--    scoped (own row, role='user', inserted in the last 2 minutes) so this
--    can't become a general "delete my messages" capability — coach_messages
--    otherwise stays append-only from the client (see docs/sql/33-coach.sql).
--
-- 2. A per-user "unlimited Coach messages" dev toggle, admin-only. Owner-
--    writable through the same row-level policy that already covers the
--    onboarding flags on user_profiles (see docs/sql/22-onboarding-state.sql)
--    — no new RLS policy needed. Even if a non-admin flipped their own row's
--    flag, enforce_coach_rate_limit() only honors it behind is_grind_admin(),
--    so it has no effect for anyone but the app's single admin account.

alter table user_profiles
  add column if not exists coach_dev_unlimited boolean not null default false;

create or replace function grind_coach_refund_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from coach_messages
   where id = p_message_id
     and user_id = auth.uid()
     and role = 'user'
     and created_at > now() - interval '2 minutes';
end;
$$;

revoke all on function grind_coach_refund_message(uuid) from public;
grant execute on function grind_coach_refund_message(uuid) to authenticated;

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

  if is_grind_admin() and exists (
    select 1 from user_profiles
     where id = new.user_id and coach_dev_unlimited
  ) then
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
