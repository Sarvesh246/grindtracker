-- 29 — Client is_pr guard, optional RPE, delete-my-data RPC
-- Idempotent. Apply after 30.

-- ---------------------------------------------------------------------------
-- 1) Optional RPE (1–10); null = not logged
-- ---------------------------------------------------------------------------
alter table public.session_logs
  add column if not exists rpe smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'session_logs_rpe_range'
  ) then
    alter table public.session_logs
      add constraint session_logs_rpe_range
      check (rpe is null or (rpe >= 1 and rpe <= 10));
  end if;
end $$;

comment on column public.session_logs.rpe is
  'Optional rating of perceived exertion (1–10). Null = not logged.';

-- ---------------------------------------------------------------------------
-- 2) Never trust client-supplied is_pr — recompute sets it on finish
--
-- PostgREST clients connect as `authenticated` / `anon`. Security-definer
-- RPCs (grind_recompute_stats, complete_session, …) run as their owner
-- (typically postgres) and must still be able to write real PR flags.
-- ---------------------------------------------------------------------------
create or replace function public.grind_guard_session_log_is_pr()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.is_pr := false;
  end if;
  return new;
end;
$$;

drop trigger if exists grind_guard_session_log_is_pr on public.session_logs;
create trigger grind_guard_session_log_is_pr
  before insert or update of is_pr, weight, reps, is_warmup, is_skipped
  on public.session_logs
  for each row
  execute function public.grind_guard_session_log_is_pr();

-- ---------------------------------------------------------------------------
-- 3) Wipe the caller's GRIND data (keeps auth.users — sign out / re-setup)
-- ---------------------------------------------------------------------------
create or replace function public.delete_my_grind_data()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  delete from public.session_logs
    where session_id in (select id from public.sessions where user_id = uid);
  delete from public.sessions where user_id = uid;
  delete from public.exercises where user_id = uid;
  delete from public.user_stats where user_id = uid;
  delete from public.user_badges where user_id = uid;
  delete from public.body_weights where user_id = uid;
  delete from public.user_day_categories where user_id = uid;
  delete from public.user_rotation where user_id = uid;
  delete from public.user_rest_days where user_id = uid;
  delete from public.user_rest_dates where user_id = uid;
  delete from public.feedback where user_id = uid;
  delete from public.friendships
    where requester_id = uid or addressee_id = uid;

  if to_regclass('public.progress_photo_groups') is not null then
    delete from public.progress_photos
      where group_id in (select id from public.progress_photo_groups where user_id = uid);
    delete from public.progress_photo_groups where user_id = uid;
  end if;

  if to_regclass('public.push_subscriptions') is not null then
    delete from public.push_subscriptions where user_id = uid;
  end if;
  if to_regclass('public.notification_prefs') is not null then
    delete from public.notification_prefs where user_id = uid;
  end if;
  if to_regclass('public.scheduled_notifications') is not null then
    delete from public.scheduled_notifications where user_id = uid;
  end if;

  delete from public.user_profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_grind_data() from public;
grant execute on function public.delete_my_grind_data() to authenticated;
