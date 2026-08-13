-- Phase 43: preserve rest-weekday history when the schedule changes
-- Idempotent. Apply AFTER 42.
--
-- Paste this whole file into the Supabase SQL editor.
--
-- Bug: set_rest_weekday(false) DELETEd the user_rest_days row. Streaks are
-- derived from grind_is_rest_day over the full history, so removing Thursday
-- from Settings made every past Thursday look like a missed workout — even
-- though that week still only used 2 rest days under the old schedule.
--
-- Fix: soft-end the interval with effective_until (exclusive). Past dates keep
-- counting; today and future dates of that weekday do not. Re-enabling inserts
-- a new open-ended row starting at the next occurrence (same anti-cheat as 39).
--
-- If a streak already broke from a prior Settings change, restore the ended
-- interval (insert trigger allows historical rows when effective_until is set),
-- then refresh_stats(local today):
--   insert into public.user_rest_days (user_id, day_of_week, effective_from, effective_until)
--   values ('<uid>', 4, '1970-01-01', '<date-you-removed-it>');
--   select public.refresh_stats('<YYYY-MM-DD>');

begin;
set local lock_timeout = '30s';

-- ════════════════════════════════════════════════════════════════════════════
-- 1. effective_until + multi-interval primary key
-- ════════════════════════════════════════════════════════════════════════════

alter table public.user_rest_days
  add column if not exists effective_until date;

comment on column public.user_rest_days.effective_until is
  'Exclusive end date. null = currently active. Soft-set by set_rest_weekday(false) so past coverage survives schedule changes.';

alter table public.user_rest_days
  drop constraint if exists user_rest_days_until_after_from;
alter table public.user_rest_days
  add constraint user_rest_days_until_after_from
  check (effective_until is null or effective_until > effective_from);

-- Allow multiple intervals per weekday (active + ended history).
do $$
begin
  if exists (
    select 1
      from pg_constraint
     where conrelid = 'public.user_rest_days'::regclass
       and contype = 'p'
  ) then
    alter table public.user_rest_days drop constraint user_rest_days_pkey;
  end if;
exception
  when undefined_object then
    null;
end $$;

alter table public.user_rest_days
  drop constraint if exists user_rest_days_pkey;

do $$
begin
  alter table public.user_rest_days
    add primary key (user_id, day_of_week, effective_from);
exception
  when invalid_table_definition then
    -- Already the correct primary key from a prior apply.
    null;
end $$;

create unique index if not exists user_rest_days_one_active
  on public.user_rest_days (user_id, day_of_week)
  where effective_until is null;

-- Clients must not wipe history (or invent until dates). Mutate via RPC only.
revoke delete on public.user_rest_days from authenticated, anon;
revoke update on public.user_rest_days from authenticated, anon;
revoke insert on public.user_rest_days from authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Insert guard: only coerce effective_from for open-ended (active) rows
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grind_guard_rest_day_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_today date := grind_safe_local_date(null);
begin
  -- Historical backfill rows carry effective_until and must keep their range.
  if new.effective_until is not null then
    return new;
  end if;
  if new.effective_from <= v_today then
    new.effective_from := public.grind_next_weekday(v_today, new.day_of_week, true);
  end if;
  return new;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. grind_is_rest_day honors effective_until
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grind_is_rest_day(p_user uuid, p_date date)
returns boolean
language plpgsql
stable
strict
set search_path = public
as $$
begin
  if auth.uid() is not null and p_user is distinct from auth.uid() then
    raise exception 'SELF_ONLY' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.user_rest_dates d
     where d.user_id = p_user and d.rest_date = p_date
  ) then
    return true;
  end if;

  if exists (
    select 1 from public.user_rest_cancels c
     where c.user_id = p_user and c.rest_date = p_date
  ) then
    return false;
  end if;

  return exists (
    select 1 from public.user_rest_days r
     where r.user_id = p_user
       and r.day_of_week = extract(dow from p_date)::int
       and p_date >= r.effective_from
       and (r.effective_until is null or p_date < r.effective_until)
  );
end;
$$;

revoke all on function public.grind_is_rest_day(uuid, date) from public, anon;
grant execute on function public.grind_is_rest_day(uuid, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Weekly budget counts only currently-active weekdays
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grind_rest_budget(p_user uuid, p_as_of date)
returns int
language sql
stable
strict
set search_path = public
as $$
  select count(*)::int
    from public.user_rest_days
   where user_id = p_user
     and effective_until is null
     and effective_from <= public.grind_week_start(p_as_of) + 6;
$$;

create or replace function public.grind_rest_budget(p_user uuid)
returns int
language sql
stable
strict
set search_path = public
as $$
  select public.grind_rest_budget(p_user, grind_safe_local_date(null));
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. set_rest_weekday soft-ends instead of deleting
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.set_rest_weekday(
  p_day_of_week int,
  p_enabled boolean,
  p_local_date date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_date date := grind_safe_local_date(p_local_date);
  v_from date;
  v_existing date;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'INVALID_DOW' using errcode = '22023';
  end if;

  if not p_enabled then
    -- Never took effect yet — nothing historical to preserve.
    delete from public.user_rest_days
     where user_id = v_user
       and day_of_week = p_day_of_week
       and effective_until is null
       and effective_from >= v_date;

    -- Soft-end: every past occurrence of this weekday stays a rest day.
    update public.user_rest_days
       set effective_until = v_date
     where user_id = v_user
       and day_of_week = p_day_of_week
       and effective_until is null
       and effective_from < v_date;

    perform public.grind_recompute_stats(v_user, v_date);
    return json_build_object('enabled', false);
  end if;

  select effective_from into v_existing
    from public.user_rest_days
   where user_id = v_user
     and day_of_week = p_day_of_week
     and effective_until is null
   limit 1;

  if v_existing is not null then
    return json_build_object('enabled', true, 'effective_from', v_existing);
  end if;

  v_from := public.grind_next_weekday(v_date, p_day_of_week, true);
  insert into public.user_rest_days (user_id, day_of_week, effective_from, effective_until)
  values (v_user, p_day_of_week, v_from, null);

  perform public.grind_recompute_stats(v_user, v_date);
  return json_build_object('enabled', true, 'effective_from', v_from);
end;
$$;

revoke all on function public.set_rest_weekday(int, boolean, date) from public, anon;
grant execute on function public.set_rest_weekday(int, boolean, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Streak reminders: use grind_is_rest_day (from/until/cancels/one-offs)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.schedule_streak_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
begin
  with candidates as (
    select
      np.user_id,
      (p_now at time zone np.timezone)::date as local_date,
      extract(hour from (p_now at time zone np.timezone))::int as local_hour
    from notification_prefs np
    join user_stats us on us.user_id = np.user_id
   where np.enabled = true
     and np.streak_reminder = true
     and coalesce(us.current_streak, 0) > 0
     and exists (
       select 1 from pg_timezone_names t where t.name = np.timezone
     )
     and extract(hour from (p_now at time zone np.timezone))::int
         >= np.streak_reminder_hour
     and exists (
       select 1 from push_subscriptions ps where ps.user_id = np.user_id
     )
     and not exists (
       select 1
         from sessions s
        where s.user_id = np.user_id
          and s.completed_at is not null
          and (
            s.local_date = (p_now at time zone np.timezone)::date
            or (
              s.local_date is null
              and (s.completed_at at time zone np.timezone)::date
                  = (p_now at time zone np.timezone)::date
            )
          )
     )
     and not exists (
       select 1
         from sessions s
        where s.user_id = np.user_id
          and s.completed_at is null
          and (
            s.local_date = (p_now at time zone np.timezone)::date
            or (
              s.local_date is null
              and (s.started_at at time zone np.timezone)::date
                  = (p_now at time zone np.timezone)::date
            )
          )
     )
     and not public.grind_is_rest_day(
       np.user_id,
       (p_now at time zone np.timezone)::date
     )
  ),
  inserted as (
    insert into scheduled_notifications (user_id, kind, fire_at, payload, dedupe_key)
    select
      c.user_id,
      'streak_daily',
      p_now,
      jsonb_build_object(
        'title', 'Streak on the line',
        'body', 'Log a workout or mark a rest day',
        'url', '/home',
        'tag', 'grind-streak',
        'badge', 1
      ),
      'streak_daily:' || c.user_id::text || ':' || c.local_date::text
    from candidates c
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*)::int into v_inserted from inserted;
  return v_inserted;
end;
$$;

revoke all on function public.schedule_streak_reminders(timestamptz) from public, anon;
grant execute on function public.schedule_streak_reminders(timestamptz) to service_role;

commit;
