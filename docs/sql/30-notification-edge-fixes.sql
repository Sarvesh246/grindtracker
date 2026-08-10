-- 30 — Notification edge-case hardening
--
-- 1) schedule_streak_reminders: catch-up if the exact reminder-hour cron misssed,
--    skip users with an open (incomplete) session today, and skip invalid IANA
--    timezones so one bad row can't abort the whole RPC.
-- 2) Optional cleanup helper for old sent/cancelled schedule rows (manual / cron).

create or replace function schedule_streak_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
begin
  -- DST: spring-forward may skip the hour; fall-back may hit twice.
  -- unique(dedupe_key) prevents double-send.
  -- Catch-up: if the exact reminder-hour job failed, later hourly ticks still
  -- insert when local_hour >= streak_reminder_hour and no row exists for today.
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
     -- Invalid IANA names raise; only schedule for zones Postgres recognizes.
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
     -- Mid-workout: don't nag "streak on the line" while they're already logging.
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
     and not exists (
       select 1
         from user_rest_days urd
        where urd.user_id = np.user_id
          and urd.day_of_week
              = extract(dow from (p_now at time zone np.timezone)::date)::int
     )
     and not exists (
       select 1
         from user_rest_dates urx
        where urx.user_id = np.user_id
          and urx.rest_date = (p_now at time zone np.timezone)::date
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

revoke all on function schedule_streak_reminders(timestamptz) from public, anon;
grant execute on function schedule_streak_reminders(timestamptz) to service_role;

-- Best-effort prune of terminal schedule rows older than 14 days (call from cron
-- if the table grows; safe to run repeatedly).
create or replace function grind_prune_scheduled_notifications()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from scheduled_notifications
   where (sent_at is not null or cancelled_at is not null)
     and coalesce(sent_at, cancelled_at) < now() - interval '14 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function grind_prune_scheduled_notifications() from public, anon;
grant execute on function grind_prune_scheduled_notifications() to service_role;
