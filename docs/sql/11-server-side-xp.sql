-- Phase 11: make XP, levels, streaks and PRs server-authoritative.
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ---------------
-- Until now the browser computed XP and wrote `user_stats` directly:
--
--     await supabase.from('user_stats').update({ xp_total: newXpTotal, ... })
--
-- RLS correctly stopped you writing SOMEONE ELSE'S stats — but nothing stopped
-- you writing your own. Any user could open devtools and set `xp_total` to
-- 999999999, taking rank 1 on every leaderboard they appear on. With one real
-- user that is theoretical; with a competitive friends leaderboard and a few
-- hundred users it is inevitable.
--
-- THE APPROACH
-- ------------
-- Rather than validate the client's arithmetic, stats are now DERIVED. Nothing
-- is stored that isn't recomputable from `sessions` + `session_logs`:
--
--   xp        = per completed session: 100 + 25 x (PR sets) + 50 on every 7th
--               consecutive day  (unchanged from src/lib/utils/gamification.ts)
--   level     = floor((1 + sqrt(1 + 8*xp/500)) / 2)      (the triangular curve)
--   streaks   = runs of consecutive local dates with a completed session
--   is_pr     = set weight > best non-warm-up weight in any EARLIER completed
--               session for that exercise
--
-- `grind_recompute_stats()` rebuilds all of it from scratch, so it is
-- idempotent, self-healing, and impossible to inflate: to fake XP you would
-- have to fake the underlying workout logs, which are bounded by the sanity
-- CHECK constraints from migration 10.
--
-- Direct client writes to `user_stats` are then revoked. Every mutation goes
-- through the RPCs below.
--
-- ⚠️  APPLY 10-leaderboard-authz.sql FIRST.
-- ⚠️  This RECOMPUTES existing stats. If the stored values ever drifted from
--     what the logs justify, totals will change on first run. See the dry-run
--     query at the bottom of this file — run it BEFORE applying.

begin;

-- ── Local workout date ──────────────────────────────────────────────────────
-- Streak logic is timezone-sensitive (see CLAUDE.md → Dates & timezones) and
-- Postgres only sees a UTC `completed_at`, so the user's local calendar date
-- has to be recorded explicitly. Backfilled from UTC for existing rows — an
-- approximation for history, exact from here on because the client passes it.

alter table sessions add column if not exists local_date date;

update sessions
   set local_date = (completed_at at time zone 'utc')::date
 where local_date is null
   and completed_at is not null;

create index if not exists sessions_user_localdate_idx
  on sessions (user_id, local_date) where completed_at is not null;

-- ── Level curve ─────────────────────────────────────────────────────────────
-- Mirrors getLevel() in src/lib/utils/gamification.ts. If you change one,
-- change both.

create or replace function grind_level_for_xp(p_xp numeric)
returns int
language sql immutable
set search_path = public
as $$
  select greatest(1, floor((1 + sqrt(1 + 8 * greatest(p_xp, 0) / 500.0)) / 2)::int);
$$;

-- ── The recompute ───────────────────────────────────────────────────────────
-- Rebuilds every derived value for one user. security definer so it can write
-- `user_stats` after client writes are revoked below.

create or replace function grind_recompute_stats(p_user uuid, p_local_date date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today          date := coalesce(p_local_date, (now() at time zone 'utc')::date);
  v_xp_total       numeric := 0;
  v_total_workouts int := 0;
  v_last_date      date;
  v_current_streak int := 0;
  v_longest_streak int := 0;
begin
  -- 1. Recompute PR flags.
  --    A set is a PR when its weight beats the best non-warm-up weight from any
  --    EARLIER completed session for the same exercise. Every set within one
  --    session shares the same baseline, so hitting the same top weight twice in
  --    a session doesn't count twice.
  with sess as (
    select s.id as session_id, s.completed_at, sl.exercise_id,
           max(sl.weight) as session_max
      from sessions s
      join session_logs sl on sl.session_id = s.id
     where s.user_id = p_user
       and s.completed_at is not null
       and sl.is_warmup = false
       and sl.weight is not null
     group by s.id, s.completed_at, sl.exercise_id
  ),
  prior as (
    select session_id, exercise_id,
           max(session_max) over (
             partition by exercise_id
             order by completed_at, session_id
             rows between unbounded preceding and 1 preceding
           ) as prior_best
      from sess
  ),
  flags as (
    select sl.id,
           (sl.is_warmup = false
             and sl.weight is not null
             and sl.weight > coalesce(p.prior_best, -1)) as pr
      from session_logs sl
      join sessions s on s.id = sl.session_id
      left join prior p
        on p.session_id = sl.session_id
       and p.exercise_id = sl.exercise_id
     where s.user_id = p_user
       and s.completed_at is not null
  )
  update session_logs sl
     set is_pr = f.pr
    from flags f
   where sl.id = f.id
     and sl.is_pr is distinct from f.pr;

  -- 2. Per-session XP → sessions.xp_earned: 100 per completed session, +25 per
  --    PR set, +50 when that session's streak day is a multiple of 7.
  --    `streak_day` is the day's position within its consecutive-date run,
  --    derived by the classic gaps-and-islands trick (a date minus its dense row
  --    number is constant within a run). Computed inline as a CTE — NOT a temp
  --    table. A session-local TEMP TABLE with `on commit drop` here poisoned the
  --    PL/pgSQL plan cache on Supabase's pooled PostgREST connections: the plan
  --    bound to the temp table's OID, the table was dropped at commit, and the
  --    next request on the same backend failed with `relation "_grind_runs" does
  --    not exist`. That deterministically broke workout completion (the retry on
  --    the client can't recover a deterministic server error). See migration 13.
  with dates as (
    select distinct local_date as d
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
  ),
  grouped as (
    select d, d - (row_number() over (order by d))::int as grp
      from dates
  ),
  runs as (
    select d,
           row_number() over (partition by grp order by d)::int as streak_day
      from grouped
  )
  update sessions s
     set xp_earned = ps.xp
    from (
      select s2.id,
             100
             + 25 * coalesce((
                 select count(*) from session_logs sl
                  where sl.session_id = s2.id and sl.is_pr = true
               ), 0)
             + case
                 when r.streak_day is not null and r.streak_day % 7 = 0 then 50
                 else 0
               end as xp
        from sessions s2
        left join runs r on r.d = s2.local_date
       where s2.user_id = p_user
         and s2.completed_at is not null
    ) ps
   where s.id = ps.id
     and s.xp_earned is distinct from ps.xp;

  -- 3. Totals straight off the freshly-written per-session XP — one source of
  --    truth, no duplicated arithmetic.
  select coalesce(sum(xp_earned), 0), count(*)
    into v_xp_total, v_total_workouts
    from sessions
   where user_id = p_user
     and completed_at is not null;

  -- 4. Streaks — the same gaps-and-islands runs, collapsed to the three numbers
  --    we store. A streak survives only if the last workout was today or
  --    yesterday in the user's own calendar; otherwise it has lapsed.
  with dates as (
    select distinct local_date as d
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
  ),
  grouped as (
    select d, d - (row_number() over (order by d))::int as grp
      from dates
  ),
  runs as (
    select d, count(*) over (partition by grp)::int as run_len
      from grouped
  ),
  last_run as (
    select d, run_len from runs order by d desc limit 1
  )
  select
    (select d from last_run),
    (select coalesce(max(run_len), 0) from runs),
    case
      when (select d from last_run) is null then 0
      when v_today - (select d from last_run) <= 1 then (select run_len from last_run)
      else 0
    end
  into v_last_date, v_longest_streak, v_current_streak;

  -- 5. Persist.
  insert into user_stats (
    user_id, xp_total, level, current_streak, longest_streak,
    last_workout_date, total_workouts, updated_at
  )
  values (
    p_user, v_xp_total, grind_level_for_xp(v_xp_total),
    coalesce(v_current_streak, 0), coalesce(v_longest_streak, 0),
    v_last_date, v_total_workouts, now()
  )
  on conflict (user_id) do update set
    xp_total          = excluded.xp_total,
    level             = excluded.level,
    current_streak    = excluded.current_streak,
    longest_streak    = greatest(user_stats.longest_streak, excluded.longest_streak),
    last_workout_date = excluded.last_workout_date,
    total_workouts    = excluded.total_workouts,
    updated_at        = now();
end;
$$;

revoke all on function grind_recompute_stats(uuid, date) from public, anon, authenticated;

-- ── Client-facing RPCs ──────────────────────────────────────────────────────
-- Each one verifies ownership itself, because `security definer` means RLS is
-- not doing it for us.

-- Clamp a client-supplied local date to something physically possible. Real
-- timezones span UTC-12..UTC+14, so ±1 day around UTC covers every legitimate
-- user while stopping someone claiming a date in 2043 to farm streak bonuses.
create or replace function grind_safe_local_date(p_local_date date)
returns date
language sql immutable
set search_path = public
as $$
  select least(
    greatest(coalesce(p_local_date, (now() at time zone 'utc')::date),
             (now() at time zone 'utc')::date - 1),
    (now() at time zone 'utc')::date + 1
  );
$$;

/**
 * Finish an in-progress workout. Returns the numbers the completion modal needs.
 */
create or replace function complete_session(
  p_session_id uuid,
  p_local_date date default null,
  p_note       text default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_date      date := grind_safe_local_date(p_local_date);
  v_prev_xp   numeric := 0;
  v_prev_lvl  int := 1;
  v_row       user_stats%rowtype;
  v_xp_earned int := 0;
  v_prs       json;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  -- Ownership + state check in one shot. Completing an already-completed
  -- session would otherwise double-count it.
  if not exists (
    select 1 from sessions
     where id = p_session_id and user_id = v_user and completed_at is null
  ) then
    raise exception 'SESSION_NOT_OPEN: not found, not yours, or already completed'
      using errcode = '42501';
  end if;

  select coalesce(xp_total, 0), coalesce(level, 1)
    into v_prev_xp, v_prev_lvl
    from user_stats where user_id = v_user;

  update sessions
     set completed_at = now(),
         local_date   = v_date,
         note         = coalesce(p_note, note)
   where id = p_session_id;

  perform grind_recompute_stats(v_user, v_date);

  select * into v_row from user_stats where user_id = v_user;
  select xp_earned into v_xp_earned from sessions where id = p_session_id;

  -- PR exercises for this session, for the modal's "NEW PR" list.
  select coalesce(json_agg(json_build_object('name', e.name, 'weight', x.w)), '[]'::json)
    into v_prs
    from (
      select sl.exercise_id, max(sl.weight) as w
        from session_logs sl
       where sl.session_id = p_session_id and sl.is_pr = true
       group by sl.exercise_id
    ) x
    join exercises e on e.id = x.exercise_id;

  return json_build_object(
    'xp_earned',      v_xp_earned,
    'xp_total',       v_row.xp_total,
    'prev_level',     v_prev_lvl,
    'level',          v_row.level,
    'leveled_up',     v_row.level > v_prev_lvl,
    'current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak,
    'last_workout_date', v_row.last_workout_date,
    'total_workouts', v_row.total_workouts,
    -- Count of PR *sets* (drives XP and the modal's counter); pr_exercises is
    -- deduplicated per exercise for the "NEW PR" list.
    'pr_count',       (select count(*) from session_logs
                        where session_id = p_session_id and is_pr = true),
    'pr_exercises',   v_prs
  );
end;
$$;

/**
 * Reverse a completion (the 10-minute undo banner). Reopens the session and
 * lets the recompute walk the stats back — no stored "previous value" needed,
 * so an undo can never restore a number the logs don't justify.
 */
create or replace function uncomplete_session(
  p_session_id uuid,
  p_local_date date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  user_stats%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if not exists (
    select 1 from sessions
     where id = p_session_id and user_id = v_user and completed_at is not null
  ) then
    raise exception 'SESSION_NOT_COMPLETED: not found, not yours, or already open'
      using errcode = '42501';
  end if;

  update sessions
     set completed_at = null, xp_earned = 0, local_date = null
   where id = p_session_id;

  perform grind_recompute_stats(v_user, grind_safe_local_date(p_local_date));

  select * into v_row from user_stats where user_id = v_user;
  return json_build_object(
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'total_workouts', v_row.total_workouts
  );
end;
$$;

/**
 * Delete a logged workout (the past-workout screen) and settle up.
 */
create or replace function delete_session(
  p_session_id uuid,
  p_local_date date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  user_stats%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  delete from sessions where id = p_session_id and user_id = v_user;
  if not found then
    raise exception 'SESSION_NOT_FOUND' using errcode = '42501';
  end if;

  perform grind_recompute_stats(v_user, grind_safe_local_date(p_local_date));

  select * into v_row from user_stats where user_id = v_user;
  return json_build_object(
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'total_workouts', v_row.total_workouts
  );
end;
$$;

/**
 * Settle stats without changing a session. Two callers:
 *   - the home page, to lapse a stale streak in the user's own timezone
 *   - the past-workout screen, after inserting/editing a backdated session
 */
create or replace function refresh_stats(p_local_date date default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_row  user_stats%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  perform grind_recompute_stats(v_user, grind_safe_local_date(p_local_date));

  select * into v_row from user_stats where user_id = v_user;
  return json_build_object(
    'xp_total',       v_row.xp_total,
    'level',          v_row.level,
    'current_streak', v_row.current_streak,
    'longest_streak', v_row.longest_streak,
    'total_workouts', v_row.total_workouts,
    'last_workout_date', v_row.last_workout_date
  );
end;
$$;

revoke all on function complete_session(uuid, date, text)   from public, anon;
revoke all on function uncomplete_session(uuid, date)       from public, anon;
revoke all on function delete_session(uuid, date)           from public, anon;
revoke all on function refresh_stats(date)                  from public, anon;
grant execute on function complete_session(uuid, date, text) to authenticated;
grant execute on function uncomplete_session(uuid, date)     to authenticated;
grant execute on function delete_session(uuid, date)         to authenticated;
grant execute on function refresh_stats(date)                to authenticated;

commit;

-- ── Revoke direct stat writes ───────────────────────────────────────────────
-- The whole point. After this, `update user_stats set xp_total = 999999999`
-- from the browser fails regardless of RLS, because the role has no UPDATE
-- privilege on the table at all. Only the definer functions above can write it.
--
-- Column-level grants on `sessions` keep the client able to rename a day or
-- edit a note, while `completed_at` and `xp_earned` become server-only.

revoke update on user_stats from authenticated;
revoke insert on user_stats from authenticated;

revoke update on sessions from authenticated;
grant update (day_type, started_at, note) on sessions to authenticated;

-- Seed a stats row for anyone who doesn't have one yet, since the client can no
-- longer create it.
insert into user_stats (user_id)
select u.id from auth.users u
 where not exists (select 1 from user_stats us where us.user_id = u.id);

-- Keep new signups seeded automatically.
create or replace function grind_seed_user_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into user_stats (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists seed_user_stats on auth.users;
create trigger seed_user_stats
  after insert on auth.users
  for each row execute function grind_seed_user_stats();


-- ════════════════════════════════════════════════════════════════════════════
--  DRY RUN — run this BEFORE the migration above.
--
--  Shows what each user's stats WOULD become versus what is stored now. If the
--  deltas are all zero, applying this migration changes nothing but the
--  enforcement. Non-zero deltas mean the stored values had drifted (double
--  counted undos, a lost recompute, or hand-edited XP) and will be corrected.
--
--    select * from grind_stats_drift();
--
--  Ships as a function so you can re-run it after applying, too.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function grind_stats_drift()
returns table (
  user_id uuid, username text,
  stored_xp numeric, derived_xp numeric, xp_delta numeric,
  stored_workouts int, derived_workouts int
)
language sql stable
security definer
set search_path = public
as $$
  with runs as (
    select s.user_id, d.d,
           row_number() over (partition by s.user_id, d.d - d.rn order by d.d)::int as streak_day
      from (
        select user_id, local_date as d,
               row_number() over (partition by user_id order by local_date)::int as rn
          from (select distinct user_id, local_date
                  from sessions
                 where completed_at is not null and local_date is not null) q
      ) d
      join (select distinct user_id from sessions) s on s.user_id = d.user_id
  ),
  derived as (
    select s.user_id,
           sum(100
               + 25 * coalesce((select count(*) from session_logs sl
                                 where sl.session_id = s.id and sl.is_pr = true), 0)
               + case when r.streak_day % 7 = 0 then 50 else 0 end) as xp,
           count(*)::int as workouts
      from sessions s
      left join runs r on r.user_id = s.user_id and r.d = s.local_date
     where s.completed_at is not null
     group by s.user_id
  )
  select us.user_id, up.username,
         us.xp_total::numeric, coalesce(d.xp, 0), coalesce(d.xp, 0) - us.xp_total::numeric,
         us.total_workouts, coalesce(d.workouts, 0)
    from user_stats us
    left join derived d on d.user_id = us.user_id
    left join user_profiles up on up.id = us.user_id
   order by abs(coalesce(d.xp, 0) - us.xp_total::numeric) desc;
$$;

revoke all on function grind_stats_drift() from public, anon;
grant execute on function grind_stats_drift() to authenticated;
