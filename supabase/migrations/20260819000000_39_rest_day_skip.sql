-- Phase 39: rest-today skip + weekly rest budget
-- Idempotent. Apply AFTER 37 (and 38 if schema-integrity is already applied).
--
-- Paste this whole file into the Supabase SQL editor.
--
-- What this does:
--   1. Recurring rest weekdays no longer cover today/the past when newly
--      added (closes the "toggle today in Settings, save streak, toggle off"
--      bypass). Existing rows keep working historically.
--   2. Weekly cap: rest days in a Mon–Sun week cannot exceed the number of
--      configured rest weekdays. Extra one-off rest days steal a later
--      scheduled rest day that week, or fail with REST_BUDGET_EXCEEDED.
--   3. toggle_rest_today(p_local_date) — Home "Rest today" / undo.
--   4. Streak reminder copy: rotating variants; body points at Home, not Settings.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. user_rest_days.effective_from
-- ════════════════════════════════════════════════════════════════════════════
-- Existing rows default to 1970-01-01 so historical streaks do not change.
-- New inserts are forced to the next occurrence of that weekday strictly
-- after the viewer's local today (trigger below).

alter table public.user_rest_days
  add column if not exists effective_from date not null default '1970-01-01';

comment on column public.user_rest_days.effective_from is
  'First calendar date this weekday counts as rest. New inserts are strictly after today so Settings cannot cover a missed workout the same day.';

-- ════════════════════════════════════════════════════════════════════════════
-- 2. user_rest_cancels — a scheduled rest day given up this week to skip today
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.user_rest_cancels (
  user_id     uuid not null references auth.users(id) on delete cascade,
  rest_date   date not null,
  stolen_for  date not null,
  primary key (user_id, rest_date)
);

alter table public.user_rest_cancels enable row level security;

drop policy if exists "own rest cancels" on public.user_rest_cancels;
create policy "own rest cancels"
  on public.user_rest_cancels for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

comment on table public.user_rest_cancels is
  'Recurring rest dates suppressed this week because a one-off rest (stolen_for) used the weekly budget.';

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Helpers
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grind_next_weekday(p_from date, p_dow int, p_strict boolean)
returns date
language sql
immutable
strict
set search_path = public
as $$
  select case
    when p_strict then
      p_from + (((p_dow - extract(dow from p_from)::int + 7) % 7) +
        case when extract(dow from p_from)::int = p_dow then 7 else 0 end) * interval '1 day'
    else
      p_from + ((p_dow - extract(dow from p_from)::int + 7) % 7) * interval '1 day'
  end::date;
$$;

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
  );
end;
$$;

revoke all on function public.grind_is_rest_day(uuid, date) from public, anon;
grant execute on function public.grind_is_rest_day(uuid, date) to authenticated;

-- Monday of the week containing p_date. Matches Home's "this week" and lets a
-- Wednesday skip steal this week's upcoming Sunday.
create or replace function public.grind_week_start(p_date date)
returns date
language sql
immutable
strict
set search_path = public
as $$
  select p_date - ((extract(dow from p_date)::int + 6) % 7);
$$;

create or replace function public.grind_week_rest_count(p_user uuid, p_date date)
returns int
language sql
stable
strict
set search_path = public
as $$
  select count(*)::int
    from generate_series(
           public.grind_week_start(p_date),
           public.grind_week_start(p_date) + 6,
           interval '1 day'
         ) as gs(d)
   where public.grind_is_rest_day(p_user, gs.d::date);
$$;

create or replace function public.grind_rest_budget(p_user uuid)
returns int
language sql
stable
strict
set search_path = public
as $$
  select count(*)::int from public.user_rest_days where user_id = p_user;
$$;

-- Keep the self-only gate from 20; rest detection now includes effective_from + cancels.
create or replace function public.grind_dates_connected(p_user uuid, p_from date, p_to date)
returns boolean
language plpgsql
stable
strict
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and p_user is distinct from auth.uid() then
    raise exception 'SELF_ONLY' using errcode = '42501';
  end if;

  return not exists (
    select 1
      from generate_series(
             least(p_from, p_to) + 1,
             greatest(p_from, p_to) - 1,
             interval '1 day'
           ) as gs(d)
     where not public.grind_is_rest_day(p_user, gs.d::date)
  );
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Triggers — Settings cannot cover today; weekly cap + auto-steal
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grind_guard_rest_day_insert()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_today date := grind_safe_local_date(null);
begin
  if new.effective_from <= v_today then
    new.effective_from := public.grind_next_weekday(v_today, new.day_of_week, true);
  end if;
  return new;
end;
$$;

drop trigger if exists grind_guard_rest_day_insert on public.user_rest_days;
create trigger grind_guard_rest_day_insert
  before insert on public.user_rest_days
  for each row
  execute function public.grind_guard_rest_day_insert();

-- Clients must not UPDATE effective_from back to today to save a missed streak.
revoke update on public.user_rest_days from authenticated, anon;

grant select, insert, update, delete on public.user_rest_cancels to authenticated;

create or replace function public.grind_guard_rest_date_budget()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_budget int;
  v_count  int;
  v_week_start date;
  v_week_end date;
  v_steal date;
begin
  v_budget := public.grind_rest_budget(new.user_id);
  if v_budget <= 0 then
    raise exception 'REST_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;

  v_week_start := public.grind_week_start(new.rest_date);
  v_week_end := v_week_start + 6;
  v_count := public.grind_week_rest_count(new.user_id, new.rest_date);

  if v_count <= v_budget then
    return new;
  end if;

  select gs.d::date
    into v_steal
    from generate_series(new.rest_date + 1, v_week_end, interval '1 day') as gs(d)
   where public.grind_is_rest_day(new.user_id, gs.d::date)
     and not exists (
       select 1 from public.user_rest_dates d
        where d.user_id = new.user_id and d.rest_date = gs.d::date
     )
   order by gs.d
   limit 1;

  if v_steal is null then
    raise exception 'REST_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.user_rest_cancels (user_id, rest_date, stolen_for)
  values (new.user_id, v_steal, new.rest_date)
  on conflict (user_id, rest_date) do update set stolen_for = excluded.stolen_for;

  return new;
end;
$$;

drop trigger if exists grind_guard_rest_date_budget on public.user_rest_dates;
create trigger grind_guard_rest_date_budget
  after insert on public.user_rest_dates
  for each row
  execute function public.grind_guard_rest_date_budget();

create or replace function public.grind_guard_rest_date_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  delete from public.user_rest_cancels
   where user_id = old.user_id and stolen_for = old.rest_date;
  return old;
end;
$$;

drop trigger if exists grind_guard_rest_date_delete on public.user_rest_dates;
create trigger grind_guard_rest_date_delete
  after delete on public.user_rest_dates
  for each row
  execute function public.grind_guard_rest_date_delete();

-- AFTER INSERT sees the new row, so grind_week_rest_count includes it.
-- steal happens in AFTER so grind_is_rest_day already counts the one-off.

-- ════════════════════════════════════════════════════════════════════════════
-- 5. toggle_rest_today
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.toggle_rest_today(p_local_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_date date := grind_safe_local_date(p_local_date);
  v_budget int;
  v_was_one_off boolean;
  v_was_rest boolean;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  v_budget := public.grind_rest_budget(v_user);
  v_was_one_off := exists (
    select 1 from public.user_rest_dates d
     where d.user_id = v_user and d.rest_date = v_date
  );
  v_was_rest := public.grind_is_rest_day(v_user, v_date);

  if v_was_one_off then
    delete from public.user_rest_dates
     where user_id = v_user and rest_date = v_date;
    perform grind_recompute_stats(v_user, v_date);
    return json_build_object('rest', false, 'undone', true);
  end if;

  if v_was_rest then
    return json_build_object('rest', true, 'scheduled', true);
  end if;

  if v_budget <= 0 then
    raise exception 'REST_BUDGET_EXCEEDED' using errcode = 'P0001';
  end if;

  insert into public.user_rest_dates (user_id, rest_date)
  values (v_user, v_date);

  perform grind_recompute_stats(v_user, v_date);
  return json_build_object('rest', true, 'undone', false);
end;
$$;

revoke all on function public.toggle_rest_today(date) from public, anon;
grant execute on function public.toggle_rest_today(date) to authenticated;

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
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_day_of_week < 0 or p_day_of_week > 6 then
    raise exception 'INVALID_DOW' using errcode = '22023';
  end if;

  if not p_enabled then
    delete from public.user_rest_days
     where user_id = v_user and day_of_week = p_day_of_week;
    return json_build_object('enabled', false);
  end if;

  v_from := public.grind_next_weekday(v_date, p_day_of_week, true);
  insert into public.user_rest_days (user_id, day_of_week, effective_from)
  values (v_user, p_day_of_week, v_from)
  on conflict (user_id, day_of_week) do nothing;
  return json_build_object('enabled', true, 'effective_from', v_from);
end;
$$;

revoke all on function public.set_rest_weekday(int, boolean, date) from public, anon;
grant execute on function public.set_rest_weekday(int, boolean, date) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. delete_my_grind_data — also clear cancels
-- ════════════════════════════════════════════════════════════════════════════

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
  delete from public.user_rest_cancels where user_id = uid;
  delete from public.user_rest_days where user_id = uid;
  delete from public.user_rest_dates where user_id = uid;
  if to_regclass('public.user_flex_days') is not null then
    delete from public.user_flex_days where user_id = uid;
  end if;
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

  if to_regclass('public.coach_action_proposals') is not null then
    delete from public.coach_action_proposals where user_id = uid;
  end if;
  if to_regclass('public.coach_messages') is not null then
    delete from public.coach_messages
      where conversation_id in (
        select id from public.coach_conversations where user_id = uid
      );
  end if;
  if to_regclass('public.coach_conversations') is not null then
    delete from public.coach_conversations where user_id = uid;
  end if;

  delete from public.user_profiles where id = uid;
end;
$$;

revoke all on function public.delete_my_grind_data() from public;
grant execute on function public.delete_my_grind_data() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Streak reminder variants (Home CTA, not Settings)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function schedule_streak_reminders(p_now timestamptz default now())
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
  variants as (
    select * from (values
      (0, 'Still time.', 'Your streak''s waiting. Log a session, or tap Rest today on Home.'),
      (1, 'The bar isn''t going to lift itself.', 'One workout keeps it honest. Or Rest today on Home.'),
      (2, 'Don''t ghost the gym.', 'You''re still in it. Log something, or tap Rest today.'),
      (3, 'G checked the board.', 'No session yet. Finish one, or Rest today on Home.'),
      (4, 'Streak''s in overtime.', 'Evening''s the easy save. Train, or Rest today on Home.'),
      (5, 'Same you as yesterday.', 'That''s the whole trick. Log it, or tap Rest today.'),
      (6, 'Unfinished business.', 'The day''s still open. Knock out a session or Rest today.'),
      (7, 'Keep GRINDing.', 'A short one counts. Log it, or Rest today on Home.')
    ) as v(idx, title, body)
  ),
  inserted as (
    insert into scheduled_notifications (user_id, kind, fire_at, payload, dedupe_key)
    select
      c.user_id,
      'streak_daily',
      p_now,
      jsonb_build_object(
        'title', v.title,
        'body', v.body,
        'url', '/home',
        'tag', 'grind-streak',
        'badge', 1
      ),
      'streak_daily:' || c.user_id::text || ':' || c.local_date::text
    from candidates c
    join variants v
      on v.idx = abs(hashtext(c.user_id::text || ':' || c.local_date::text)) % 8
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*)::int into v_inserted from inserted;
  return v_inserted;
end;
$$;

revoke all on function schedule_streak_reminders(timestamptz) from public, anon;
grant execute on function schedule_streak_reminders(timestamptz) to service_role;

commit;
