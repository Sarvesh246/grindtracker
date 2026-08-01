-- Phase 14: rest days — planned days off that bridge a streak instead of ending it.
-- Idempotent: safe to re-run. Apply AFTER 11 (and 13, which replaced the recompute).
--
-- WHY THIS EXISTS
-- ---------------
-- Until now a streak was a run of CONSECUTIVE calendar dates with a completed
-- session. Nobody trains seven days a week, so the streak — the app's main
-- consistency signal — was unreachable for every user with a sane program. It
-- punished the rest day that the program prescribes.
--
-- Two mechanisms, deliberately different in kind:
--
--   1. SCHEDULED rest days (`user_rest_settings.weekdays`) — the days of the week
--      you plan not to train. Part of your program, so they're unlimited and free.
--   2. REST PASSES (`user_rest_dates`) — an ad-hoc "count yesterday as a rest day"
--      claimed from the home screen when life got in the way. Rationed, because an
--      unlimited retroactive patch would make the streak meaningless.
--
-- WHAT A REST DAY DOES (and doesn't)
-- ----------------------------------
-- A rest day BRIDGES a gap; it does not COUNT as a streak day. The streak number
-- stays "how many times you trained in this unbroken run" — the same unit it has
-- always been — so taking rest can never inflate it. This mirrors how a streak
-- freeze works in every app that has one, and it keeps the +50 XP milestone
-- ("every 7th day of a streak") honest: it now fires every 7 WORKOUTS inside a
-- run rather than every 7 calendar days, which for a 4-day-a-week lifter is the
-- first time it has ever been reachable at all.
--
-- Because `grind_recompute_stats` DERIVES everything (migration 11), there is no
-- migration of stored values here and no way to desync: changing your rest days
-- re-derives your history on the next recompute, and a claimed pass can restore a
-- streak that had already been zeroed. Nothing is stored that isn't recomputable.

begin;

-- ── Scheduled rest weekdays ─────────────────────────────────────────────────
-- `weekdays` holds Postgres `extract(dow)` values: 0 = Sunday … 6 = Saturday.
-- At least one training day must remain, or "streak" stops meaning anything —
-- hence the <= 6 length cap. The UI enforces the same rule; this is the backstop.

create table if not exists user_rest_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  weekdays   int[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table user_rest_settings drop constraint if exists user_rest_settings_weekdays_valid;
alter table user_rest_settings add constraint user_rest_settings_weekdays_valid check (
  weekdays <@ array[0,1,2,3,4,5,6]
  and coalesce(array_length(weekdays, 1), 0) <= 6
);

-- Duplicates and ordering can't be expressed in a CHECK (no subqueries allowed
-- there), and rejecting a client that sent [3,3,1] would be pointlessly hostile
-- when the intent is unambiguous. Normalize instead: sort, dedupe, drop
-- out-of-range values, and stamp updated_at so the client can't lie about it.
create or replace function grind_normalize_rest_weekdays()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.weekdays := coalesce(
    (select array_agg(distinct w order by w) from unnest(new.weekdays) w where w between 0 and 6),
    '{}'::int[]
  );
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists normalize_rest_weekdays on user_rest_settings;
create trigger normalize_rest_weekdays
  before insert or update on user_rest_settings
  for each row execute function grind_normalize_rest_weekdays();

alter table user_rest_settings enable row level security;

drop policy if exists "own rest settings" on user_rest_settings;
create policy "own rest settings"
  on user_rest_settings for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── Claimed rest passes ─────────────────────────────────────────────────────
-- One row per date the user retroactively declared a rest day. Read-only to the
-- client: inserts go exclusively through `claim_rest_days` below, because the
-- rationing lives there. A policy on this table can't express "at most N in a
-- rolling window" without subquerying itself, and the client obviously can't be
-- trusted to count for us — same reasoning as the feedback rate-limit trigger.

create table if not exists user_rest_dates (
  user_id    uuid not null references auth.users(id) on delete cascade,
  rest_date  date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, rest_date)
);

alter table user_rest_dates enable row level security;

drop policy if exists "own rest dates" on user_rest_dates;
drop policy if exists "read own rest dates" on user_rest_dates;
create policy "read own rest dates"
  on user_rest_dates for select
  using (auth.uid() = user_id);

revoke insert, update, delete on user_rest_dates from authenticated, anon;
revoke all on user_rest_settings from anon;

-- ── Rationing constants ─────────────────────────────────────────────────────
-- ⚠️  Mirrored in src/lib/utils/restDays.ts (REST_PASS_LIMIT / REST_PASS_WINDOW_DAYS
--     / REST_PASS_MAX_AGE_DAYS). Change one, change both — the client pre-checks
--     the same numbers so a blocked claim fails fast with a real message.
--
--   limit  2 passes per rolling 7 days — enough for a sick day or a work trip,
--          not enough to paper over quitting.
--   age    a pass may only be claimed for the last 7 days. Older than that you
--          didn't take a rest day, you stopped.

create or replace function grind_rest_pass_limit() returns int
  language sql immutable set search_path = public as $$ select 2 $$;
create or replace function grind_rest_pass_window() returns int
  language sql immutable set search_path = public as $$ select 7 $$;

-- ── Is a given date a rest day for this user? ───────────────────────────────
-- Scheduled weekday OR claimed pass. `p_weekdays` is passed in rather than looked
-- up so the hot loops below read the setting once per recompute, not once per day.

create or replace function grind_is_rest_day(p_user uuid, p_date date, p_weekdays int[])
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select extract(dow from p_date)::int = any(coalesce(p_weekdays, '{}'::int[]))
      or exists (
           select 1 from user_rest_dates r
            where r.user_id = p_user and r.rest_date = p_date
         );
$$;

revoke all on function grind_is_rest_day(uuid, date, int[]) from public, anon, authenticated;

/**
 * True when every calendar day STRICTLY BETWEEN two dates is a rest day — i.e.
 * the gap is bridged and the streak survives it. Adjacent dates (and any
 * non-positive difference) are trivially bridged: there is nothing in between.
 *
 * A gap longer than a year is rejected without enumerating it. That isn't a
 * performance guard so much as a correctness one: no plausible rest schedule
 * bridges 400 days, and enumerating an arbitrary gap would let a single ancient
 * session make every recompute walk decades of dates.
 */
create or replace function grind_gap_is_rest(p_user uuid, p_from date, p_to date, p_weekdays int[])
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select case
    when p_to - p_from <= 1   then true
    when p_to - p_from > 400  then false
    else not exists (
      select 1
        from generate_series(1, (p_to - p_from) - 1) as g(i)
       where not grind_is_rest_day(p_user, p_from + g.i, p_weekdays)
    )
  end;
$$;

revoke all on function grind_gap_is_rest(uuid, date, date, int[]) from public, anon, authenticated;

-- ── The recompute, rest-day aware ───────────────────────────────────────────
-- Structurally identical to migration 13 (no temp tables — see the note there
-- about poisoned plan caches on pooled PostgREST connections). The ONLY change
-- is how runs are formed: instead of "the previous workout was exactly one day
-- ago", a new run starts when the gap back to the previous workout contains at
-- least one non-rest day.
--
-- `streak_day` still counts WORKOUTS within the run (row_number over the run),
-- so bridging never manufactures XP for days you didn't train.

create or replace function grind_recompute_stats(p_user uuid, p_local_date date default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today          date := coalesce(p_local_date, (now() at time zone 'utc')::date);
  v_weekdays       int[];
  v_xp_total       numeric := 0;
  v_total_workouts int := 0;
  v_last_date      date;
  v_current_streak int := 0;
  v_longest_streak int := 0;
  v_last_run_len   int := 0;
begin
  -- Read the rest schedule once; every helper below takes it as an argument.
  select coalesce(weekdays, '{}'::int[]) into v_weekdays
    from user_rest_settings where user_id = p_user;
  v_weekdays := coalesce(v_weekdays, '{}'::int[]);

  -- 1. Recompute PR flags. Unchanged by rest days — a PR is about weight, not
  --    calendar position.
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
  --    PR set, +50 on every 7th workout of an unbroken run.
  --
  --    Runs are gaps-and-islands again, but the "same island" test is now
  --    `grind_gap_is_rest(prev, d)` rather than `d - prev = 1`. Because that
  --    test isn't a simple arithmetic identity, the run id is a running sum of
  --    a break flag rather than the classic date-minus-row-number trick.
  with dates as (
    select distinct local_date as d
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
  ),
  seq as (
    select d, lag(d) over (order by d) as prev from dates
  ),
  marked as (
    select d,
           case
             when prev is null then 1
             when grind_gap_is_rest(p_user, prev, d, v_weekdays) then 0
             else 1
           end as breaks
      from seq
  ),
  runs as (
    select d,
           sum(breaks) over (order by d rows between unbounded preceding and current row) as grp
      from marked
  ),
  numbered as (
    select d, row_number() over (partition by grp order by d)::int as streak_day
      from runs
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
                 when n.streak_day is not null and n.streak_day % 7 = 0 then 50
                 else 0
               end as xp
        from sessions s2
        left join numbered n on n.d = s2.local_date
       where s2.user_id = p_user
         and s2.completed_at is not null
    ) ps
   where s.id = ps.id
     and s.xp_earned is distinct from ps.xp;

  -- 3. Totals straight off the freshly-written per-session XP.
  select coalesce(sum(xp_earned), 0), count(*)
    into v_xp_total, v_total_workouts
    from sessions
   where user_id = p_user
     and completed_at is not null;

  -- 4. Streaks, from the same rest-aware runs. The current streak survives when
  --    the stretch from the last workout up to (but excluding) today is entirely
  --    rest — which subsumes the old "today or yesterday" rule, since an empty
  --    stretch is vacuously all-rest.
  with dates as (
    select distinct local_date as d
      from sessions
     where user_id = p_user
       and completed_at is not null
       and local_date is not null
  ),
  seq as (
    select d, lag(d) over (order by d) as prev from dates
  ),
  marked as (
    select d,
           case
             when prev is null then 1
             when grind_gap_is_rest(p_user, prev, d, v_weekdays) then 0
             else 1
           end as breaks
      from seq
  ),
  runs as (
    select d,
           sum(breaks) over (order by d rows between unbounded preceding and current row) as grp
      from marked
  ),
  lengths as (
    select d, count(*) over (partition by grp)::int as run_len from runs
  ),
  last_run as (
    select d, run_len from lengths order by d desc limit 1
  )
  select
    (select d from last_run),
    (select coalesce(max(run_len), 0) from lengths),
    (select coalesce(max(run_len), 0) from last_run)
  into v_last_date, v_longest_streak, v_last_run_len;

  v_current_streak := case
    when v_last_date is null then 0
    when grind_gap_is_rest(p_user, v_last_date, v_today, v_weekdays) then v_last_run_len
    else 0
  end;

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

-- ── Claiming a rest pass ────────────────────────────────────────────────────
/**
 * Spend rest passes on one or more dates, then settle stats.
 *
 * Every rule is enforced here because this is the only way a row reaches
 * `user_rest_dates` (the client has no INSERT privilege):
 *
 *   • the date must be within the last `grind_rest_pass_window()` days and not
 *     in the future — you can't pre-book, and you can't retro-fix last month;
 *   • a date you actually trained is rejected outright rather than silently
 *     eaten, because that request means the caller's view of history is wrong;
 *   • a date already covered by your scheduled weekdays, or already claimed, is
 *     skipped without charging a pass (it's already a rest day — nothing to buy);
 *   • the resulting number of passes inside the rolling window may not exceed
 *     `grind_rest_pass_limit()`. Checked against what WOULD exist after the
 *     insert, so a batch can't slip past a per-row check.
 *
 * Returns the post-claim stats plus the remaining allowance, so the caller can
 * repaint the streak and the "N passes left" affordance from one round trip.
 */
create or replace function claim_rest_days(
  p_dates      date[],
  p_local_date date default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user     uuid := auth.uid();
  v_today    date := grind_safe_local_date(p_local_date);
  v_weekdays int[];
  v_window   int  := grind_rest_pass_window();
  v_limit    int  := grind_rest_pass_limit();
  v_d        date;
  v_wanted   date[] := '{}';
  v_used     int;
  v_row      user_stats%rowtype;
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_dates is null or array_length(p_dates, 1) is null then
    raise exception 'REST_NO_DATES: nothing to claim' using errcode = '22023';
  end if;

  select coalesce(weekdays, '{}'::int[]) into v_weekdays
    from user_rest_settings where user_id = v_user;
  v_weekdays := coalesce(v_weekdays, '{}'::int[]);

  foreach v_d in array p_dates loop
    if v_d > v_today then
      raise exception 'REST_FUTURE_DATE: cannot claim a rest day that has not happened'
        using errcode = '22023';
    end if;
    if v_today - v_d > v_window then
      raise exception 'REST_TOO_OLD: rest days can only be claimed for the last % days', v_window
        using errcode = '22023';
    end if;
    if exists (
      select 1 from sessions
       where user_id = v_user and completed_at is not null and local_date = v_d
    ) then
      raise exception 'REST_DATE_TRAINED: you logged a workout on that day'
        using errcode = '22023';
    end if;

    -- Already a rest day (scheduled or previously claimed) → nothing to charge.
    if not grind_is_rest_day(v_user, v_d, v_weekdays) then
      v_wanted := v_wanted || v_d;
    end if;
  end loop;

  -- Deduplicate a batch that names the same date twice.
  select coalesce(array_agg(distinct x), '{}') into v_wanted from unnest(v_wanted) x;

  if array_length(v_wanted, 1) is not null then
    -- Passes already spent inside the rolling window, plus the ones being
    -- claimed now that fall inside it.
    select count(*) into v_used
      from user_rest_dates
     where user_id = v_user
       and rest_date > v_today - v_window;

    v_used := v_used + (
      select count(*) from unnest(v_wanted) x where x > v_today - v_window
    );

    if v_used > v_limit then
      raise exception 'REST_LIMIT: only % rest days per % days', v_limit, v_window
        using errcode = '22023';
    end if;

    insert into user_rest_dates (user_id, rest_date)
    select v_user, x from unnest(v_wanted) x
    on conflict (user_id, rest_date) do nothing;
  end if;

  perform grind_recompute_stats(v_user, v_today);

  select * into v_row from user_stats where user_id = v_user;
  select count(*) into v_used
    from user_rest_dates
   where user_id = v_user
     and rest_date > v_today - v_window;

  return json_build_object(
    'xp_total',          v_row.xp_total,
    'level',             v_row.level,
    'current_streak',    v_row.current_streak,
    'longest_streak',    v_row.longest_streak,
    'total_workouts',    v_row.total_workouts,
    'last_workout_date', v_row.last_workout_date,
    'passes_used',       v_used,
    'passes_limit',      v_limit,
    'passes_remaining',  greatest(0, v_limit - v_used)
  );
end;
$$;

revoke all on function claim_rest_days(date[], date) from public, anon;
grant execute on function claim_rest_days(date[], date) to authenticated;

commit;

-- ── Re-derive everyone's stats under the new rule ───────────────────────────
-- Nobody has rest days configured yet, so `grind_gap_is_rest` degenerates to the
-- old `d - prev = 1` test and this is a no-op — it exists so the table is
-- consistent the moment the first user turns rest days on, and so re-running the
-- migration after changing the constants above settles everyone.
do $$
declare r record;
begin
  for r in select user_id from user_stats loop
    perform grind_recompute_stats(r.user_id, null);
  end loop;
end $$;
