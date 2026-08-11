-- Phase 34: Coach quota fixes (refund failed turns + admin dev-unlimited toggle)
-- Source of truth: docs/sql/34-coach-quota-fixes.sql

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
