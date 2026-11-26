-- 88 — make grind_guard_session_write actually guard (security audit 2026-11-26)
--
-- The guard let a write through whenever current_user <> session_user, on the
-- theory that only SECURITY DEFINER RPCs differ. But PostgREST logs in as
-- `authenticator` and then SET ROLEs to `authenticated`, so for every REST call
-- session_user = 'authenticator' and current_user = 'authenticated' — always
-- different. Any signed-in user could
--   POST /rest/v1/sessions {completed_at, local_date, xp_earned: 99999}
-- and inflate their streak, XP and leaderboard rank without logging a set
-- (reproduced against production in a rolled-back transaction; no sign it was
-- used — max xp_earned was 475). Gate on the invoker role instead, like
-- grind_guard_completed_session_logs already does: definer RPCs run as their
-- owner and the watch routes run as service_role, so both still pass.
--
-- Also: the client never deletes user_stats (delete_my_grind_data is a definer
-- RPC), so drop that grant; and remove push_subscriptions_endpoint_allowlist,
-- a looser duplicate of 85's push_subscriptions_provider_check that this
-- migration briefly added while it was numbered 85.

create or replace function public.grind_guard_session_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only direct API callers are gated. SECURITY DEFINER RPCs run as their
  -- owner and the watch routes run as service_role. Also honor the explicit
  -- transaction-local allow flag that complete_session & co. set.
  if current_user not in ('authenticated', 'anon')
     or current_setting('grind.allow_session_complete', true) = '1' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.completed_at is not null
       or new.xp_earned is distinct from 0
       or new.local_date is not null then
      raise exception 'COMPLETED_SESSION_DIRECT_INSERT_FORBIDDEN'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if (old.completed_at is distinct from new.completed_at)
       or (old.xp_earned is distinct from new.xp_earned)
       or (old.local_date is distinct from new.local_date)
       or (old.completed_at is not null and old.day_type is distinct from new.day_type) then
      raise exception 'SESSION_COMPLETION_FIELDS_FORBIDDEN'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

revoke delete on public.user_stats from anon, authenticated;

-- Trigger functions need no EXECUTE grant (it is checked at CREATE TRIGGER).
revoke execute on function public.grind_seed_user_stats() from public, anon, authenticated;
revoke execute on function public.grind_guard_rest_date_delete() from public, anon, authenticated;
revoke execute on function public.grind_touch_coach_action_proposal() from public, anon, authenticated;

alter table public.push_subscriptions
  drop constraint if exists push_subscriptions_endpoint_allowlist;

delete from public.grind_migrations where version = '85-security-audit-hardening';
insert into public.grind_migrations (version) values ('88-session-guard-fix') on conflict (version) do nothing;
