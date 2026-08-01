-- Phase 14: rest days — recurring weekly rest days and one-off confirmed rest
-- dates, and a rest-day-aware streak calculation.
-- Idempotent: safe to re-run. Apply after 13-recompute-no-temp-table.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- The streak algorithm previously treated any gap bigger than 1 calendar day
-- as broken (see `grind_recompute_stats` in 11/13: `v_today - last_date <= 1`,
-- and the `d - row_number()` gaps-and-islands trick, both of which only
-- recognize literally-consecutive calendar dates). That's wrong for anyone
-- who intentionally rests on a schedule (e.g. every Tuesday/Saturday) or
-- retroactively confirms a specific missed day was a planned rest day — their
-- streak shouldn't reset just because they didn't work out on a rest day.
--
-- THE APPROACH
-- ------------
-- Two new per-user config tables (`user_rest_days` for the recurring weekly
-- pattern, `user_rest_dates` for one-off confirmed dates), a small helper
-- (`grind_dates_connected`) that tests whether every day strictly between two
-- dates is covered by one or the other, and a rewritten `grind_recompute_stats`
-- that uses that helper — via PL/pgSQL arrays and a loop, NOT a temp table —
-- to group workout dates into rest-day-aware "runs" instead of pure
-- consecutive-calendar-date runs. See 13-recompute-no-temp-table.sql for why
-- a session-local TEMP TABLE is off the table entirely on this function: it
-- poisons the PL/pgSQL plan cache on Supabase's pooled PostgREST connections
-- and deterministically broke workout completion in prod last time.
--
-- Nothing here changes the underlying security model from 11: stats are still
-- fully derived from sessions + session_logs (+ now user_rest_days /
-- user_rest_dates), the client still has no UPDATE/INSERT privilege on
-- user_stats, and grind_recompute_stats stays security definer + revoked from
-- direct client execution.
--
-- NON-DISRUPTIVE ROLLOUT: immediately after applying this migration, both new
-- tables are empty for every existing user, so grind_dates_connected degrades
-- to exactly the old adjacency-only behavior (no days strictly between two
-- literally-consecutive dates ⇒ vacuously connected; any gap bigger than that
-- has no covering rest days yet ⇒ not connected). Nobody's stored streak
-- changes on next recompute until they actually configure a rest day or
-- confirm a missed one.

begin;

-- ── Tables ───────────────────────────────────────────────────────────────
-- Both are small, single-owner config tables — same shape and RLS pattern as
-- `user_flex_days` (08-flex-days.sql): a single `FOR ALL` policy testing
-- `auth.uid() = user_id`, since every row is fully owned by one user and
-- there's no cross-user read/write case to split by command (contrast with
-- `friendships`, which needed per-command policies — see 12).

-- Recurring weekly rest days. day_of_week matches Postgres `extract(dow from
-- date)` (and JS Date.getDay()): 0 = Sunday .. 6 = Saturday.
create table if not exists user_rest_days (
  user_id     uuid not null references auth.users(id) on delete cascade,
  day_of_week int  not null check (day_of_week between 0 and 6),
  primary key (user_id, day_of_week)
);

alter table user_rest_days enable row level security;

drop policy if exists "own rest days" on user_rest_days;
create policy "own rest days"
  on user_rest_days for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One-off confirmed rest dates — either set retroactively (the client prompts
-- the user to confirm a specific gap date was a rest day, from the home
-- dashboard) or proactively. Upper-bounded the same way `grind_safe_local_date`
-- bounds session dates, so a date can't be claimed far in the future.
create table if not exists user_rest_dates (
  user_id   uuid not null references auth.users(id) on delete cascade,
  rest_date date not null check (rest_date <= (now() at time zone 'utc')::date + 1),
  primary key (user_id, rest_date)
);

alter table user_rest_dates enable row level security;

drop policy if exists "own rest dates" on user_rest_dates;
create policy "own rest dates"
  on user_rest_dates for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Rest-day connectivity helper ────────────────────────────────────────────
-- Two workout dates (or a workout date and "today") are CONNECTED — the
-- streak isn't broken by the gap between them — when every calendar day
-- strictly BETWEEN them (both endpoints excluded) is a rest day: either a
-- recurring weekly rest day (extract(dow from that day) is in
-- user_rest_days) or a one-off confirmed rest date (in user_rest_dates).
-- A 1-day gap (literally adjacent dates) or a 0-day gap (the same date) has
-- no days strictly between the endpoints, so it is trivially connected —
-- this generalizes the old hardcoded "<= 1 day" rule instead of replacing it
-- with something stricter.
--
-- p_from/p_to are treated as order-independent: the SET of days strictly
-- between two dates doesn't depend on which one is "first", so out-of-order
-- input (should never happen — callers always pass chronological order) is
-- normalized with least()/greatest() rather than erroring or silently
-- returning a wrong answer.
create or replace function grind_dates_connected(p_user uuid, p_from date, p_to date)
returns boolean
language sql
stable
strict
set search_path = public
as $$
  select not exists (
    select 1
      from generate_series(
             least(p_from, p_to) + 1,
             greatest(p_from, p_to) - 1,
             interval '1 day'
           ) as gs(d)
     where not exists (
             select 1
               from user_rest_days urd
              where urd.user_id = p_user
                and urd.day_of_week = extract(dow from gs.d)::int
           )
       and not exists (
             select 1
               from user_rest_dates urx
              where urx.user_id = p_user
                and urx.rest_date = gs.d::date
           )
  );
$$;

revoke all on function grind_dates_connected(uuid, date, date) from public, anon;
grant execute on function grind_dates_connected(uuid, date, date) to authenticated;

-- ── grind_recompute_stats — rewritten for rest-day-aware runs ──────────────
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

  -- Rest-day-aware run computation. PL/pgSQL local arrays + a loop, NOT a
  -- temp table (see migration 13) — zipped back into SQL via
  -- unnest(...) WITH ORDINALITY where a query needs the rows (step 2 only;
  -- step 4 reuses the same arrays with plain scalar indexing).
  v_dates       date[];
  v_run_id      int[];
  v_streak_day  int[];
  v_run_len     int[];
  v_n           int;
  v_i           int;
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

  -- 2a. Build rest-day-aware runs, once, reused by the XP milestone bonus
  --    (2b) below AND the streak totals (4). Replaces the old pure-SQL
  --    gaps-and-islands trick (`d - row_number() over (order by d)`), which
  --    only recognized literally-consecutive calendar dates.
  --
  --    `array(select ...)` — NOT array_agg — so a user with zero completed
  --    sessions gets v_dates = '{}' (empty array), never NULL. array_agg over
  --    zero rows returns NULL, and relying on unnest(NULL::date[]) silently
  --    degrading to zero rows is fragile — starting from a guaranteed
  --    non-NULL empty array makes every step below (array_length, the loops,
  --    the final unnest zip) behave the same for "no workouts yet" as for
  --    "some workouts", with no special-casing beyond the v_n = 0 branch below.
  v_dates := array(
    select distinct local_date
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
     order by local_date
  );

  -- array_length() returns NULL (not 0) for a zero-length array — a second,
  -- separate NULL trap from array_agg's. Guard it explicitly.
  v_n := coalesce(array_length(v_dates, 1), 0);

  v_run_id     := array_fill(0, array[v_n]);
  v_streak_day := array_fill(0, array[v_n]);
  v_run_len    := array_fill(0, array[v_n]);

  if v_n > 0 then
    v_run_id[1]     := 1;
    v_streak_day[1] := 1;

    for v_i in 2 .. v_n loop
      if grind_dates_connected(p_user, v_dates[v_i - 1], v_dates[v_i]) then
        v_run_id[v_i]     := v_run_id[v_i - 1];
        v_streak_day[v_i] := v_streak_day[v_i - 1] + 1;
      else
        v_run_id[v_i]     := v_run_id[v_i - 1] + 1;
        v_streak_day[v_i] := 1;
      end if;
    end loop;

    -- Backward pass: every date in a run ends up sharing that run's LENGTH,
    -- because streak_day increases monotonically within a run and resets to
    -- 1 at the next one, so the run's final streak_day IS its length.
    v_run_len[v_n] := v_streak_day[v_n];
    for v_i in reverse (v_n - 1) .. 1 loop
      if v_run_id[v_i] = v_run_id[v_i + 1] then
        v_run_len[v_i] := v_run_len[v_i + 1];
      else
        v_run_len[v_i] := v_streak_day[v_i];
      end if;
    end loop;
  end if;

  -- 2b. Per-session XP → sessions.xp_earned: 100 per completed session, +25 per
  --    PR set, +50 when that session's streak day (from the rest-day-aware
  --    runs above) is a multiple of 7. The (date, streak_day) pairs are
  --    zipped back into rows via unnest(...) WITH ORDINALITY, joined on
  --    ordinal position — an inline CTE, NOT a temp table, so nothing
  --    survives the transaction to poison the pooled-connection plan cache.
  with runs as (
    select ud.d, sd.streak_day
      from unnest(v_dates) with ordinality as ud(d, ord)
      join unnest(v_streak_day) with ordinality as sd(streak_day, ord)
        on sd.ord = ud.ord
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

  -- 4. Streaks — off the SAME rest-day-aware runs built in 2a, no second SQL
  --    pass needed. A streak survives only if the last workout is connected
  --    to `v_today` (recurring/one-off rest days in between, OR a plain
  --    adjacent/same-day gap) — replaces the old hardcoded "<= 1 day" rule.
  if v_n = 0 then
    v_last_date      := null;
    v_longest_streak := 0;
    v_current_streak := 0;
  else
    v_last_date := v_dates[v_n];

    select coalesce(max(x), 0) into v_longest_streak from unnest(v_run_len) as x;

    if grind_dates_connected(p_user, v_last_date, v_today) then
      v_current_streak := v_run_len[v_n];
    else
      v_current_streak := 0;
    end if;
  end if;

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

commit;


-- ════════════════════════════════════════════════════════════════════════════
--  VERIFY — run these manually after applying, before/after configuring a
--  rest day. Read-only.
-- ════════════════════════════════════════════════════════════════════════════
--
--  1. Sanity: the two new tables exist and are empty for everyone (expected
--     immediately after applying, before anyone configures a rest day):
--
--       select count(*) from user_rest_days;
--       select count(*) from user_rest_dates;
--
--  2. Spot-check a recompute is a no-op for a user with no rest days
--     configured — run once, note the row, run again, confirm identical:
--
--       select xp_total, level, current_streak, longest_streak, last_workout_date, total_workouts
--         from user_stats where user_id = auth.uid();
--       select grind_recompute_stats(auth.uid());
--       select xp_total, level, current_streak, longest_streak, last_workout_date, total_workouts
--         from user_stats where user_id = auth.uid();
--
--  3. After configuring a recurring rest day (insert a row into
--     user_rest_days for today's day_of_week, or any day within your actual
--     workout gap) and calling refresh_stats, current_streak should reflect
--     the bridged gap instead of resetting to 0.
