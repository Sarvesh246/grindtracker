-- Phase 44: close the coach rate-limit race
-- Idempotent. Apply AFTER 43.
--
-- Bug: enforce_coach_rate_limit() (33-coach.sql) does two plain SELECT count(*)
-- checks inside a BEFORE INSERT FOR EACH ROW trigger with no locking. Under
-- READ COMMITTED (Postgres's default), two concurrent inserts for the same
-- user (two tabs, a client retry racing the original request) each take their
-- own snapshot, both see the same pre-insert count, both pass the check, and
-- both commit — the burst/daily cap can be exceeded by however many requests
-- race. Each accepted message costs an LLM call, so this is a quota-bypass /
-- cost-abuse vector, not just a UX nit.
--
-- Fix: take a per-user advisory xact lock before counting. The lock is
-- released automatically at transaction end and only ever contended by the
-- same user's own concurrent requests, so it adds no cross-user contention.

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

  -- Serialize concurrent inserts for this user so the counts below can't be
  -- read by two racing transactions before either one commits.
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));

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
