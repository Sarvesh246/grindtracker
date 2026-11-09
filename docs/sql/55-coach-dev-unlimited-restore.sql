-- Phase 55: restore the Coach dev-unlimited bypass in the rate-limit trigger
-- Idempotent. Apply AFTER 54.
--
-- Bug: migration 34 taught enforce_coach_rate_limit() to skip the caps for the
-- admin account when user_profiles.coach_dev_unlimited is on. Migration 44
-- then redefined the whole function (to add the per-user advisory lock) from
-- the 33 body, which silently dropped that early return. Since 44 the toggle
-- only fooled the app layer (rateLimit.ts / the chat route / the UI badge);
-- the BEFORE INSERT trigger still raised COACH_RATE_LIMIT_BURST at 8 messages
-- per 10 minutes and COACH_RATE_LIMIT_DAILY at 15 per 24 hours, even for the
-- admin with "Dev (unlimited)" showing.
--
-- Fix: 44's body (advisory lock + both caps) with 34's bypass put back. The
-- bypass sits BEFORE the lock on purpose: it only ever applies to the admin
-- who has opted out of the caps, so there is nothing to serialize and no
-- reason to hold the per-user lock for those inserts.
--
-- Security is unchanged from 34: the column alone grants nothing. The row is
-- owner-writable, so the function re-checks is_grind_admin() (email match in
-- auth.users) before honoring it; a non-admin flipping their own flag gets no
-- bypass. After this, the only ceiling on the admin is Google's own Gemini
-- quota upstream.
--
-- If you ever redefine enforce_coach_rate_limit() again, start from THIS file,
-- not 33 or 44, or the bypass will silently disappear a second time.

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

  -- Admin dev toggle: no app-side caps. Must stay above the lock + counts.
  if is_grind_admin() and exists (
    select 1 from user_profiles
     where id = new.user_id and coach_dev_unlimited
  ) then
    return new;
  end if;

  -- Serialize concurrent inserts for this user so the counts below can't be
  -- read by two racing transactions before either one commits (see 44).
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
