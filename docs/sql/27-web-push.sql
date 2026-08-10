-- Phase 27: Web Push — subscriptions, notification prefs, scheduled sends
-- Idempotent. Apply AFTER 26-friend-profile-total-sets-fix.sql.
--
-- Stores per-device push subscriptions, per-user notification preferences, and
-- scheduled notification rows (rest-end / rest-warn / streak). The Vercel cron
-- route claims due rows via security-definer RPCs that are executable only by
-- service_role (never anon/authenticated). Client routes use RLS owner-only
-- policies for prefs/schedule; subscription upsert goes through
-- upsert_push_subscription() so an endpoint can transfer between accounts.

begin;

-- ── Tables ─────────────────────────────────────────────────────────────────

create table if not exists push_subscriptions (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  endpoint        text        not null,
  p256dh          text        not null,
  auth            text        not null,
  expiration_time timestamptz,
  updated_at      timestamptz not null default now(),
  -- One browser push endpoint → one owner. Re-subscribe after account switch
  -- uses upsert_push_subscription() (security definer) to transfer the row.
  unique (endpoint)
);

create index if not exists push_subscriptions_user_idx
  on push_subscriptions (user_id);

alter table push_subscriptions enable row level security;

drop policy if exists "own push subscriptions" on push_subscriptions;
create policy "own push subscriptions"
  on push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists notification_prefs (
  user_id              uuid    primary key references auth.users(id) on delete cascade,
  enabled              boolean not null default false,
  rest_complete        boolean not null default true,
  rest_warning_10s     boolean not null default false,
  workout_status       boolean not null default true,
  streak_reminder      boolean not null default true,
  -- Local hour 17–21; default 19:00.
  streak_reminder_hour int     not null default 19
    check (streak_reminder_hour between 17 and 21),
  -- IANA timezone from Intl.DateTimeFormat().resolvedOptions().timeZone
  timezone             text    not null default 'UTC',
  updated_at           timestamptz not null default now()
);

alter table notification_prefs enable row level security;

drop policy if exists "own notification prefs" on notification_prefs;
create policy "own notification prefs"
  on notification_prefs for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create table if not exists scheduled_notifications (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  kind         text        not null
    check (kind in ('rest_end', 'rest_warn', 'streak_daily')),
  fire_at      timestamptz not null,
  payload      jsonb       not null default '{}'::jsonb,
  dedupe_key   text        not null,
  cancelled_at timestamptz,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  unique (dedupe_key)
);

create index if not exists scheduled_notifications_due_idx
  on scheduled_notifications (fire_at)
  where cancelled_at is null and sent_at is null;

create index if not exists scheduled_notifications_user_idx
  on scheduled_notifications (user_id);

alter table scheduled_notifications enable row level security;

-- Owners may insert/update/cancel their own *unsent* schedules. sent_at is
-- cron-only via claim_due_notifications (security definer bypasses RLS).
-- Clients must keep sent_at null on insert/update so they cannot suppress
-- delivery by forging a sent timestamp.
drop policy if exists "own scheduled notifications select" on scheduled_notifications;
create policy "own scheduled notifications select"
  on scheduled_notifications for select
  using (user_id = auth.uid());

drop policy if exists "own scheduled notifications insert" on scheduled_notifications;
create policy "own scheduled notifications insert"
  on scheduled_notifications for insert
  with check (user_id = auth.uid() and sent_at is null);

drop policy if exists "own scheduled notifications update" on scheduled_notifications;
create policy "own scheduled notifications update"
  on scheduled_notifications for update
  using (user_id = auth.uid() and sent_at is null)
  with check (user_id = auth.uid() and sent_at is null);

drop policy if exists "own scheduled notifications delete" on scheduled_notifications;
create policy "own scheduled notifications delete"
  on scheduled_notifications for delete
  using (user_id = auth.uid());

-- ── Upsert subscription (authenticated; transfers endpoint ownership) ──────

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

-- ── Claim due notifications (service_role / cron only) ─────────────────────
-- Atomically marks up to p_limit due rows as sent and returns them joined to
-- every active push subscription for that user (one row per sub × notification).

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
  -- Executable only by service_role (revoked from anon/authenticated below).
  -- due CTE locks candidates with SKIP LOCKED; claimed updates by join (not
  -- IN-subquery) so claim semantics stay obvious under concurrent workers.
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

-- ── Upsert streak_daily candidates for the current UTC window ──────────────
-- For each user whose local hour (prefs.timezone) equals streak_reminder_hour,
-- with streak > 0, no completed workout today (local), and today not a rest
-- day — insert a streak_daily row if one doesn't already exist for that local
-- date. Returns the number of rows inserted.
--
-- DST note: on spring-forward the reminder hour can be skipped; on fall-back
-- it can appear twice. unique(dedupe_key) prevents double-send; a skipped hour
-- simply means no reminder that day (acceptable for a 15-min cron).

create or replace function schedule_streak_reminders(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted int := 0;
begin
  -- Executable only by service_role (revoked from anon/authenticated below).
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
     -- Has at least one push subscription
     and exists (
       select 1 from push_subscriptions ps where ps.user_id = np.user_id
     )
     -- No completed workout on local today
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
     -- Today is not a rest day (recurring or one-off)
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

-- Cancel open rest schedules for a session.
-- Client dedupe_key format (must stay in sync with src/lib/push/client.ts):
--   rest:<sessionId>:<exerciseId>:end:<endsAtMs>
--   rest:<sessionId>:<exerciseId>:warn:<endsAtMs>
-- LIKE 'rest:' || session_id || ':%' matches both.

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

commit;
