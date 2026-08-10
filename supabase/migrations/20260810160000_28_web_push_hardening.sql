-- Phase 28: Web Push hardening (apply if you already ran 27 before these fixes)
-- Idempotent. Safe to re-run. Fresh installs that apply the updated 27 get the
-- same end state and can skip this file — or run it anyway (no-ops / replaces).
--
-- - claim_due_notifications: lock via due CTE, update by join
-- - scheduled_notifications RLS: clients cannot set/touch sent_at
-- - upsert_push_subscription: transfer endpoint ownership across accounts
-- - cancel_rest_schedules: document + trim session id (dedupe matches client)

begin;

-- Restrict client writes so sent_at stays cron-only
drop policy if exists "own scheduled notifications insert" on scheduled_notifications;
create policy "own scheduled notifications insert"
  on scheduled_notifications for insert
  with check (user_id = auth.uid() and sent_at is null);

drop policy if exists "own scheduled notifications update" on scheduled_notifications;
create policy "own scheduled notifications update"
  on scheduled_notifications for update
  using (user_id = auth.uid() and sent_at is null)
  with check (user_id = auth.uid() and sent_at is null);

create or replace function upsert_push_subscription(
  p_endpoint        text,
  p_p256dh          text,
  p_auth            text,
  p_expiration_time timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_endpoint is null or length(trim(p_endpoint)) = 0
     or p_p256dh is null or length(trim(p_p256dh)) = 0
     or p_auth is null or length(trim(p_auth)) = 0 then
    raise exception 'INVALID_SUBSCRIPTION' using errcode = '22023';
  end if;

  insert into push_subscriptions (user_id, endpoint, p256dh, auth, expiration_time, updated_at)
  values (v_uid, trim(p_endpoint), trim(p_p256dh), trim(p_auth), p_expiration_time, now())
  on conflict (endpoint) do update
    set user_id         = v_uid,
        p256dh          = excluded.p256dh,
        auth            = excluded.auth,
        expiration_time = excluded.expiration_time,
        updated_at      = now();
end;
$$;

revoke all on function upsert_push_subscription(text, text, text, timestamptz) from public, anon;
grant execute on function upsert_push_subscription(text, text, text, timestamptz) to authenticated;

create or replace function claim_due_notifications(p_limit int default 100)
returns table (
  notification_id uuid,
  user_id         uuid,
  kind            text,
  payload         jsonb,
  endpoint        text,
  p256dh          text,
  auth            text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select s.id
      from scheduled_notifications s
     where s.cancelled_at is null
       and s.sent_at is null
       and s.fire_at <= now()
       and exists (
         select 1 from notification_prefs np
          where np.user_id = s.user_id and np.enabled = true
       )
       and exists (
         select 1 from push_subscriptions ps where ps.user_id = s.user_id
       )
     order by s.fire_at
     limit greatest(1, least(coalesce(p_limit, 100), 500))
     for update of s skip locked
  ),
  claimed as (
    update scheduled_notifications sn
       set sent_at = now()
      from due
     where sn.id = due.id
    returning sn.id, sn.user_id, sn.kind, sn.payload
  )
  select c.id, c.user_id, c.kind, c.payload,
         ps.endpoint, ps.p256dh, ps.auth
    from claimed c
    join push_subscriptions ps on ps.user_id = c.user_id;
end;
$$;

revoke all on function claim_due_notifications(int) from public, anon, authenticated;
grant execute on function claim_due_notifications(int) to service_role;

create or replace function cancel_rest_schedules(p_session_id text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_n   int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;

  if p_session_id is null or length(trim(p_session_id)) = 0 then
    return 0;
  end if;

  -- Matches client keys: rest:<sessionId>:<exerciseId>:(end|warn):<endsAtMs>
  update scheduled_notifications
     set cancelled_at = now()
   where user_id = v_uid
     and kind in ('rest_end', 'rest_warn')
     and cancelled_at is null
     and sent_at is null
     and dedupe_key like ('rest:' || trim(p_session_id) || ':%');

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function cancel_rest_schedules(text) from public, anon;
grant execute on function cancel_rest_schedules(text) to authenticated;

-- Refresh streak RPC body only to keep DST comment in the live definition;
-- behavior unchanged (dedupe_key still prevents double-send).
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
  -- unique(dedupe_key) prevents double-send; a skipped hour = no reminder that day.
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
     and extract(hour from (p_now at time zone np.timezone))::int = np.streak_reminder_hour
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

  return coalesce(v_inserted, 0);
end;
$$;

revoke all on function schedule_streak_reminders(timestamptz) from public, anon, authenticated;
grant execute on function schedule_streak_reminders(timestamptz) to service_role;

commit;
