-- Phase 40: integrity follow-ups from the post-39 feature audit
-- Idempotent: safe to re-run. Apply AFTER 39-rest-day-skip.sql.
--
-- Paste this whole file into the Supabase SQL editor and run it BEFORE
-- (or with) the app that:
--   - treats warm-up-only sessions as unfinished
--   - calls grind_insert_coach_assistant for Coach replies
--   - seeds rotation current_index at -1
--
-- Fixes:
--   1. grind_session_has_working_set ignored is_warmup (Home Save minted +100 XP)
--   2. Client DELETE of completed sessions skipped grind_recompute_stats
--   3. Client could rewrite session_logs on completed sessions (leaderboard)
--   4. start_or_resume_session empty FOR UPDATE race
--   5. user_rest_cancels FOR ALL let a steal row be deleted (double rest)
--   6. Direct user_rest_days INSERT used UTC "today" (set_rest_weekday only)
--   7. Rest budget counted not-yet-effective weekdays
--   8. Rotation default 0 skipped the first day for new users
--   9. Coach client INSERT role=assistant skipped quota; proposal payload mutable

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Working-set predicate — warm-ups do not count
-- ════════════════════════════════════════════════════════════════════════════

create or replace function grind_session_has_working_set(p_session_id uuid)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
      from session_logs sl
     where sl.session_id = p_session_id
       and coalesce(sl.is_skipped, false) = false
       and coalesce(sl.is_warmup, false) = false
       and sl.weight is not null
       and sl.reps is not null
  );
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Only incomplete sessions may be client-deleted
-- ════════════════════════════════════════════════════════════════════════════
-- delete_session() is security definer and still removes completed rows
-- (and recomputes stats). Raw PostgREST DELETE used to leave ghost XP.

drop policy if exists "own sessions delete" on public.sessions;
create policy "own sessions delete"
  on public.sessions for delete
  using (auth.uid() = user_id and completed_at is null);

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Guard session_logs on completed sessions
-- ════════════════════════════════════════════════════════════════════════════
-- Same GUC / security-definer escape as grind_guard_session_write.
-- Live logging on OPEN sessions is unchanged. upsert_past_session,
-- coach_correct_session_weights, grind_recompute_stats, and delete_my_grind_data
-- still write because they run as definer (or set grind.allow_session_complete).

create or replace function public.grind_guard_completed_session_logs()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_sid uuid;
  v_done boolean;
begin
  if current_user is distinct from session_user
     or current_setting('grind.allow_session_complete', true) = '1' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  v_sid := case when tg_op = 'DELETE' then old.session_id else new.session_id end;

  select s.completed_at is not null
    into v_done
    from public.sessions s
   where s.id = v_sid;

  if coalesce(v_done, false) then
    raise exception 'COMPLETED_SESSION_LOGS_FORBIDDEN'
      using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists grind_guard_completed_session_logs on public.session_logs;
create trigger grind_guard_completed_session_logs
  before insert or update or delete on public.session_logs
  for each row execute function public.grind_guard_completed_session_logs();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. start_or_resume_session — unique-index race
-- ════════════════════════════════════════════════════════════════════════════
-- The previous SELECT … FOR UPDATE on an empty result locked nothing, so two
-- tabs could both INSERT and hit sessions_one_open_per_day_idx.

create or replace function start_or_resume_session(p_day_type text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  sessions%rowtype;
  v_logs json;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_day_type is null or length(btrim(p_day_type)) = 0 then
    raise exception 'DAY_TYPE_REQUIRED' using errcode = '22023';
  end if;

  insert into sessions (user_id, day_type)
  values (v_user, p_day_type)
  on conflict (user_id, day_type) where completed_at is null
  do nothing;

  select * into v_row
    from sessions
   where user_id = v_user
     and day_type = p_day_type
     and completed_at is null
   order by started_at desc
   limit 1
   for update;

  if v_row.id is null then
    raise exception 'SESSION_OPEN_FAILED' using errcode = '40001';
  end if;

  select coalesce(json_agg(row_to_json(sl) order by sl.set_number), '[]'::json)
    into v_logs
    from session_logs sl
   where sl.session_id = v_row.id;

  return json_build_object(
    'session', row_to_json(v_row),
    'logs',    v_logs,
    'resumed', (select count(*) > 0 from session_logs where session_id = v_row.id)
               or v_row.started_at < now() - interval '5 seconds'
  );
end;
$$;

revoke all on function start_or_resume_session(text) from public, anon;
grant execute on function start_or_resume_session(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. user_rest_cancels — steal rows are insert-only from the budget trigger
-- ════════════════════════════════════════════════════════════════════════════
-- The budget trigger is invoker (not definer) so INSERT must stay granted.
-- UPDATE/DELETE would let a client drop a steal and keep the one-off.

revoke update, delete on public.user_rest_cancels from authenticated, anon;

drop policy if exists "own rest cancels" on public.user_rest_cancels;
drop policy if exists "own rest cancels select" on public.user_rest_cancels;
drop policy if exists "own rest cancels insert" on public.user_rest_cancels;
create policy "own rest cancels select"
  on public.user_rest_cancels for select
  using (auth.uid() = user_id);
create policy "own rest cancels insert"
  on public.user_rest_cancels for insert
  with check (auth.uid() = user_id);

-- Undo of a one-off must still clear its steal row after DELETE is revoked.
create or replace function public.grind_guard_rest_date_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.user_rest_cancels
   where user_id = old.user_id and stolen_for = old.rest_date;
  return old;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Recurring rest weekdays — mutate only via set_rest_weekday
-- ════════════════════════════════════════════════════════════════════════════
-- Direct INSERT used grind_safe_local_date(null) (UTC) so an east-of-UTC
-- client could cover local today. The definer RPC still inserts.

revoke insert on public.user_rest_days from authenticated, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Weekly rest budget ignores weekdays that have not taken effect yet
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
  v_today date := grind_safe_local_date(null);
  v_steal date;
begin
  v_budget := public.grind_rest_budget(new.user_id, new.rest_date);
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
    from generate_series(
           greatest(new.rest_date + 1, v_today),
           v_week_end,
           interval '1 day'
         ) as gs(d)
   where public.grind_is_rest_day(new.user_id, gs.d::date)
     and not exists (
       select 1 from public.user_rest_dates d
        where d.user_id = new.user_id and d.rest_date = gs.d::date
     )
     and not exists (
       select 1 from public.sessions s
        where s.user_id = new.user_id
          and s.completed_at is not null
          and s.local_date = gs.d::date
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

  v_budget := public.grind_rest_budget(v_user, v_date);
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

-- ════════════════════════════════════════════════════════════════════════════
-- 8. Rotation pointer — never-trained users start at -1 (first day is next)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.user_rotation
  alter column current_index set default -1;

update public.user_rotation r
   set current_index = -1
 where r.current_index = 0
   and not exists (
     select 1 from public.sessions s
      where s.user_id = r.user_id
        and s.completed_at is not null
   );

-- ════════════════════════════════════════════════════════════════════════════
-- 9. Coach — user inserts are role=user; assistant rows go through a definer RPC
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists "insert own coach messages" on public.coach_messages;
create policy "insert own coach messages"
  on public.coach_messages for insert
  with check (auth.uid() = user_id and role = 'user');

create or replace function public.grind_insert_coach_assistant(
  p_content text,
  p_conversation_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_conv uuid := p_conversation_id;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if p_content is null or length(btrim(p_content)) = 0 then
    raise exception 'CONTENT_REQUIRED' using errcode = '22023';
  end if;

  if v_conv is not null
     and not exists (
       select 1 from public.coach_conversations c
        where c.id = v_conv and c.user_id = v_user
     ) then
    v_conv := null;
  end if;

  insert into public.coach_messages (user_id, role, content, conversation_id)
  values (v_user, 'assistant', left(btrim(p_content), 4000), v_conv)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.grind_insert_coach_assistant(text, uuid) from public, anon;
grant execute on function public.grind_insert_coach_assistant(text, uuid) to authenticated;

create or replace function public.grind_guard_coach_proposal_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payload is distinct from old.payload
     or new.kind is distinct from old.kind
     or new.user_id is distinct from old.user_id
     or new.conversation_id is distinct from old.conversation_id then
    raise exception 'COACH_PROPOSAL_IMMUTABLE'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists grind_guard_coach_proposal_immutable on public.coach_action_proposals;
create trigger grind_guard_coach_proposal_immutable
  before update on public.coach_action_proposals
  for each row execute function public.grind_guard_coach_proposal_immutable();

commit;
