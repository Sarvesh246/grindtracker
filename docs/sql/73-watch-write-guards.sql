-- Phase 73: Bounded health retention, per-user watch write caps, sync-log dedupe
-- Idempotent: safe to re-run. Apply AFTER 72-body-signals.sql.
-- No code depends on it: the RPCs keep their signatures and the routes already
-- answer 201 whether or not a row was stored.
--
--   1. health_retention_cleanup, replaced: deletes in batches of 5,000 and
--      stops starting new batches after 20 s, returning `more: true` when
--      rows are left for tomorrow's run. One unbatched DELETE across every
--      user would eventually outgrow the cron's 30 s and fail every day.
--   2. grind_watch_write_guard: a BEFORE INSERT trigger on the four tables a
--      watch token writes a new row to on every request (rep_lab_sets,
--      watch_telemetry, readiness_checks, body_sync_log). Each row is keyed by
--      a client id, so nothing else bounds how many one token can create; the
--      route rate limit (60/min) alone allows ~86k a day. Past a cap far above
--      real use, a new row is skipped silently (the RPC reports stored: false
--      and the watch moves on); a re-send of a row that already exists always
--      goes through, so corrections and retries are never lost.
--
--        rep_lab_sets      600 / 24 h   (a 40-set workout is 40)
--        watch_telemetry   200 / 24 h   (one per workout, plus crashes)
--        readiness_checks   30 / 24 h   (one a morning)
--        body_sync_log     400 / 24 h   (96 background + app opens)
--
--   3. body_sync_log dedupe: a snapshot whose response was lost is sent again
--      with the same taken_at, and was logged twice, which watchreport then
--      counted twice. The guard skips a row the log already has; existing
--      duplicates are removed.

begin;

-- ── 1. health_retention_cleanup, batched ─────────────────────────────────────

create or replace function public.health_retention_cleanup()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_batch  constant int := 5000;
  v_until  timestamptz := clock_timestamp() + interval '20 seconds';
  v_more   boolean := false;
  v_n      int;
  samples_deleted  int := 0;
  batches_deleted  int := 0;
  insights_deleted int := 0;
begin
  loop
    delete from public.health_samples where ctid in (
      select ctid from public.health_samples where end_at < now() - interval '180 days' limit v_batch);
    get diagnostics v_n = row_count;
    samples_deleted := samples_deleted + v_n;
    exit when v_n < v_batch;
    if clock_timestamp() > v_until then v_more := true; exit; end if;
  end loop;

  if not v_more then
    loop
      delete from public.health_ingest_batches where ctid in (
        select ctid from public.health_ingest_batches where received_at < now() - interval '30 days' limit v_batch);
      get diagnostics v_n = row_count;
      batches_deleted := batches_deleted + v_n;
      exit when v_n < v_batch;
      if clock_timestamp() > v_until then v_more := true; exit; end if;
    end loop;
  end if;

  if not v_more then
    loop
      delete from public.health_insights where ctid in (
        select ctid from public.health_insights where expires_at < now() limit v_batch);
      get diagnostics v_n = row_count;
      insights_deleted := insights_deleted + v_n;
      exit when v_n < v_batch;
      if clock_timestamp() > v_until then v_more := true; exit; end if;
    end loop;
  end if;

  return jsonb_build_object(
    'samples', samples_deleted, 'batches', batches_deleted, 'insights', insights_deleted, 'more', v_more
  );
end $$;
revoke all on function public.health_retention_cleanup() from public, anon, authenticated;
grant execute on function public.health_retention_cleanup() to service_role;

-- ── 2 + 3. watch write guard ──────────────────────────────────────────────────

-- Lookups the guard makes on every insert.
create index if not exists readiness_checks_user_created on public.readiness_checks (user_id, created_at desc);
create index if not exists body_sync_log_user_taken on public.body_sync_log (user_id, taken_at);

-- Existing duplicates (same snapshot logged twice): keep the first.
delete from public.body_sync_log l
 using public.body_sync_log k
 where l.user_id = k.user_id and l.taken_at = k.taken_at and l.id > k.id;

-- TG_ARGV[0]: rows allowed per user per 24 h. TG_ARGV[1]: the table's
-- arrival-time column.
create or replace function public.grind_watch_write_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_limit int := TG_ARGV[0]::int;
  v_hit   int;
  v_n     int;
begin
  if TG_TABLE_NAME = 'body_sync_log' then
    if new.taken_at is not null and exists (
      select 1 from public.body_sync_log where user_id = new.user_id and taken_at = new.taken_at
    ) then
      return null;
    end if;
  else
    -- A row we already have is an update through ON CONFLICT: always allowed.
    execute format('select 1 from public.%I where id = $1', TG_TABLE_NAME) using new.id into v_hit;
    if v_hit is not null then return new; end if;
  end if;

  execute format(
    'select count(*) from (select 1 from public.%I where user_id = $1 and %I > now() - interval ''24 hours'' limit $2) s',
    TG_TABLE_NAME, TG_ARGV[1]
  ) using new.user_id, v_limit into v_n;
  if v_n >= v_limit then return null; end if;
  return new;
end $$;
revoke all on function public.grind_watch_write_guard() from public, anon, authenticated;

drop trigger if exists rep_lab_sets_write_guard on public.rep_lab_sets;
create trigger rep_lab_sets_write_guard before insert on public.rep_lab_sets
  for each row execute function public.grind_watch_write_guard('600', 'created_at');

drop trigger if exists watch_telemetry_write_guard on public.watch_telemetry;
create trigger watch_telemetry_write_guard before insert on public.watch_telemetry
  for each row execute function public.grind_watch_write_guard('200', 'created_at');

drop trigger if exists readiness_checks_write_guard on public.readiness_checks;
create trigger readiness_checks_write_guard before insert on public.readiness_checks
  for each row execute function public.grind_watch_write_guard('30', 'created_at');

drop trigger if exists body_sync_log_write_guard on public.body_sync_log;
create trigger body_sync_log_write_guard before insert on public.body_sync_log
  for each row execute function public.grind_watch_write_guard('400', 'received_at');

commit;

insert into public.grind_migrations (version) values ('73-watch-write-guards') on conflict (version) do nothing;
