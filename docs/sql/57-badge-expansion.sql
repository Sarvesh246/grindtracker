-- Phase 57: 22 new badges + a one-time backfill for existing accounts.
-- Idempotent: safe to re-run. Apply after 56-coach-set-day-enabled.sql.
--
-- WHAT CHANGES
-- ------------
-- 1. Two new facts the server could not see before:
--      sessions.started_offline   — a workout begun with no connection and
--                                   synced later (Off the Grid).
--      user_stats.data_exported_at — first time the user exported their data
--                                   (Own Your Data).
--    Both are written only through narrow security-definer RPCs; the client's
--    column grants on sessions/user_stats (migration 11) are untouched.
--
-- 2. Badge evaluation moves into grind_award_badges_for(p_user). The public
--    award_earned_badges() is now a thin auth.uid() wrapper around it, so the
--    exact same rules can be run for every account in the backfill at the
--    bottom of this file. grind_award_badges_for is NOT granted to
--    authenticated — a client can still only award itself.
--
-- 3. Each new condition is skipped once its badge is earned, so the heavier
--    checks (Perfect Week, rest-day bridging, leaderboard rank) cost nothing
--    after the first award.
--
-- Leaderboard badges (Podium / Top of the Board) mirror get_leaderboard's
-- ranking (overall by XP; push/pull/legs by heaviest working set) over the
-- user + accepted friends. Ties share a rank. A board needs at least 3 people
-- for #1 and at least 4 for top-3, otherwise both would be free.
--
-- Earned when the check runs: on workout finish, on past-log save, and on
-- every Profile visit (profile/page.tsx), so event badges (feedback, export,
-- Coach plan, photos, friends) land without needing another workout.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. New columns + recording RPCs
-- ════════════════════════════════════════════════════════════════════════════

alter table sessions   add column if not exists started_offline boolean not null default false;
alter table user_stats add column if not exists data_exported_at timestamptz;

create or replace function public.mark_session_started_offline(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  update sessions
     set started_offline = true
   where id = p_session_id
     and user_id = auth.uid()
     and started_offline = false;
end;
$$;

revoke all on function public.mark_session_started_offline(uuid) from public, anon;
grant execute on function public.mark_session_started_offline(uuid) to authenticated;

create or replace function public.record_data_export()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  update user_stats
     set data_exported_at = now()
   where user_id = auth.uid()
     and data_exported_at is null;
end;
$$;

revoke all on function public.record_data_export() from public, anon;
grant execute on function public.record_data_export() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. US federal holidays (Holiday Grind). Fixed dates + nth-weekday rules,
--    no observed-day shifts — training on the actual holiday is the point.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grind_is_us_holiday(p_date date)
returns boolean
language sql
immutable
strict
set search_path = public
as $$
  select
       (m = 1  and dd = 1)                         -- New Year's Day
    or (m = 1  and dw = 1 and dd between 15 and 21) -- MLK Day (3rd Mon)
    or (m = 2  and dw = 1 and dd between 15 and 21) -- Presidents' Day (3rd Mon)
    or (m = 5  and dw = 1 and dd >= 25)             -- Memorial Day (last Mon)
    or (m = 6  and dd = 19)                         -- Juneteenth
    or (m = 7  and dd = 4)                          -- Independence Day
    or (m = 9  and dw = 1 and dd <= 7)              -- Labor Day (1st Mon)
    or (m = 10 and dw = 1 and dd between 8 and 14)  -- Columbus / Indigenous Peoples' Day
    or (m = 11 and dd = 11)                         -- Veterans Day
    or (m = 11 and dw = 4 and dd between 22 and 28) -- Thanksgiving (4th Thu)
    or (m = 12 and dd = 25)                         -- Christmas
  from (
    select extract(month from p_date)::int as m,
           extract(day   from p_date)::int as dd,
           extract(dow   from p_date)::int as dw
  ) parts;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. grind_award_badges_for — every rule, for one user
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.grind_award_badges_for(p_user uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stats user_stats%rowtype;
  v_metrics json;
  v_earned text[] := '{}';
  v_new text[] := '{}';
  v_id text;
  v_total_prs int := 0;
  v_level int := 1;
  v_had_comeback boolean := false;
  v_had_early_bird boolean := false;
  v_had_night_owl boolean := false;
  v_had_flawless boolean := false;
  v_has_full_split boolean := false;
  v_has_weekend boolean := false;
  v_dates date[];
  v_week_start date;
  v_today date := (now() at time zone 'utc')::date;
  v_candidates text[] := '{}';
  -- new-badge working values
  v_n int;
  v_flag boolean;
  v_push int; v_pull int; v_legs int;
  v_rest_bridged int;
  v_saved boolean;
  v_board_size int;
  v_best_rank int;
  v_all_but_completionist text[] := array[
    'first_workout','first_pr','streak_3','streak_7','streak_14','streak_30','streak_60',
    'workouts_10','workouts_50','workouts_100','workouts_200','workouts_365',
    'all_three_days','weekend_warrior',
    'pr_5','pr_25','pr_50','pr_100',
    'level_5','level_10','level_15','level_20',
    'volume_100k','volume_500k','volume_1m',
    'plates_225','plates_315','plates_405',
    'early_bird','night_owl','comeback','flawless',
    'rest_day_set','not_alone','rep_machine','weight_tracked',
    -- 57
    'perfect_week','saved_it','rest_day_pro','early_bird_regular','night_owl_regular',
    'warmup_ritual','triple_threat','variety_pack','max_effort',
    'hat_trick','podium_push',
    'daily_weigh_in','goal_getter','before_after',
    'squad_goals','podium','top_of_board',
    'off_the_grid','coached','holiday_grind','own_your_data','speak_up'
  ];
begin
  if p_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_stats from user_stats where user_id = p_user;
  if v_stats.user_id is null then
    return '[]'::json;
  end if;

  select coalesce(array_agg(badge_id), '{}') into v_earned
    from user_badges where user_id = p_user;

  select count(*)::int into v_total_prs
    from session_logs sl
    join sessions s on s.id = sl.session_id
   where s.user_id = p_user and sl.is_pr = true;

  v_level := grind_level_for_xp(v_stats.xp_total);

  -- ── Original 35 (unchanged from 52-audit-fixes.sql) ────────────────────────

  select json_build_object(
    'total_volume', coalesce((
      select sum(sl.weight * sl.reps)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = p_user and s.completed_at is not null
         and sl.weight is not null and sl.reps is not null
         and coalesce(sl.is_warmup, false) = false
         and coalesce(sl.is_skipped, false) = false
    ), 0),
    'max_set_weight', coalesce((
      select max(sl.weight)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = p_user and s.completed_at is not null
         and sl.weight is not null
         and coalesce(sl.is_warmup, false) = false
    ), 0),
    'max_set_reps', coalesce((
      select max(sl.reps)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = p_user and s.completed_at is not null
         and sl.reps is not null
         and coalesce(sl.is_warmup, false) = false
    ), 0),
    'has_recurring_rest_day', exists (
      select 1 from user_rest_days where user_id = p_user
    ),
    'has_accepted_friend', exists (
      select 1 from friendships
       where status = 'accepted'
         and (requester_id = p_user or addressee_id = p_user)
    ),
    'body_weight_log_count', (
      select count(*)::int from body_weights where user_id = p_user
    )
  ) into v_metrics;

  select array_agg(d order by d desc) into v_dates
    from (
      select distinct local_date as d
        from sessions
       where user_id = p_user and completed_at is not null and local_date is not null
       order by local_date desc
       limit 2
    ) q;
  if coalesce(array_length(v_dates, 1), 0) = 2 then
    v_had_comeback := (v_dates[1] - v_dates[2]) >= 14;
  end if;

  v_week_start := public.grind_week_start(v_today);

  select
    count(distinct case
      when coalesce(udc.category, s.day_type) = 'push' then 'push'
      when coalesce(udc.category, s.day_type) = 'pull' then 'pull'
      when coalesce(udc.category, s.day_type) = 'legs' then 'legs'
    end) = 3
    into v_has_full_split
    from sessions s
    left join user_day_categories udc
      on udc.user_id = p_user and udc.day_key = s.day_type
   where s.user_id = p_user
     and s.completed_at is not null
     and s.local_date is not null
     and s.local_date >= v_week_start
     and s.local_date < v_week_start + 7;

  select
    bool_or(extract(dow from s.local_date) = 0)
      and bool_or(extract(dow from s.local_date) = 6)
    into v_has_weekend
    from sessions s
   where s.user_id = p_user
     and s.completed_at is not null
     and s.local_date is not null
     and s.local_date >= v_week_start
     and s.local_date < v_week_start + 7;

  select exists (
    select 1 from sessions
     where user_id = p_user and completed_at is not null
       and start_hour is not null and start_hour < 7
  ) into v_had_early_bird;

  select exists (
    select 1 from sessions
     where user_id = p_user and completed_at is not null
       and start_hour is not null and start_hour >= 22
  ) into v_had_night_owl;

  select exists (
    select 1
      from sessions s
     where s.user_id = p_user
       and s.completed_at is not null
       and s.start_hour is not null
       and grind_session_has_working_set(s.id)
       and not exists (
         select 1 from session_logs sl
          where sl.session_id = s.id
            and coalesce(sl.is_skipped, false) = true
       )
  ) into v_had_flawless;

  if v_stats.total_workouts >= 1 then v_candidates := array_append(v_candidates, 'first_workout'); end if;
  if v_total_prs >= 1 then v_candidates := array_append(v_candidates, 'first_pr'); end if;
  if v_stats.current_streak >= 3 then v_candidates := array_append(v_candidates, 'streak_3'); end if;
  if v_stats.current_streak >= 7 then v_candidates := array_append(v_candidates, 'streak_7'); end if;
  if v_stats.current_streak >= 14 then v_candidates := array_append(v_candidates, 'streak_14'); end if;
  if v_stats.current_streak >= 30 then v_candidates := array_append(v_candidates, 'streak_30'); end if;
  if v_stats.current_streak >= 60 then v_candidates := array_append(v_candidates, 'streak_60'); end if;
  if v_stats.total_workouts >= 10 then v_candidates := array_append(v_candidates, 'workouts_10'); end if;
  if v_stats.total_workouts >= 50 then v_candidates := array_append(v_candidates, 'workouts_50'); end if;
  if v_stats.total_workouts >= 100 then v_candidates := array_append(v_candidates, 'workouts_100'); end if;
  if v_stats.total_workouts >= 200 then v_candidates := array_append(v_candidates, 'workouts_200'); end if;
  if v_stats.total_workouts >= 365 then v_candidates := array_append(v_candidates, 'workouts_365'); end if;
  if coalesce(v_has_full_split, false) then v_candidates := array_append(v_candidates, 'all_three_days'); end if;
  if coalesce(v_has_weekend, false) then v_candidates := array_append(v_candidates, 'weekend_warrior'); end if;
  if v_total_prs >= 5 then v_candidates := array_append(v_candidates, 'pr_5'); end if;
  if v_total_prs >= 25 then v_candidates := array_append(v_candidates, 'pr_25'); end if;
  if v_total_prs >= 50 then v_candidates := array_append(v_candidates, 'pr_50'); end if;
  if v_total_prs >= 100 then v_candidates := array_append(v_candidates, 'pr_100'); end if;
  if v_level >= 5 then v_candidates := array_append(v_candidates, 'level_5'); end if;
  if v_level >= 10 then v_candidates := array_append(v_candidates, 'level_10'); end if;
  if v_level >= 15 then v_candidates := array_append(v_candidates, 'level_15'); end if;
  if v_level >= 20 then v_candidates := array_append(v_candidates, 'level_20'); end if;
  if coalesce((v_metrics->>'total_volume')::numeric, 0) >= 100000 then
    v_candidates := array_append(v_candidates, 'volume_100k'); end if;
  if coalesce((v_metrics->>'total_volume')::numeric, 0) >= 500000 then
    v_candidates := array_append(v_candidates, 'volume_500k'); end if;
  if coalesce((v_metrics->>'total_volume')::numeric, 0) >= 1000000 then
    v_candidates := array_append(v_candidates, 'volume_1m'); end if;
  if coalesce((v_metrics->>'max_set_weight')::numeric, 0) >= 225 then
    v_candidates := array_append(v_candidates, 'plates_225'); end if;
  if coalesce((v_metrics->>'max_set_weight')::numeric, 0) >= 315 then
    v_candidates := array_append(v_candidates, 'plates_315'); end if;
  if coalesce((v_metrics->>'max_set_weight')::numeric, 0) >= 405 then
    v_candidates := array_append(v_candidates, 'plates_405'); end if;
  if v_had_early_bird then v_candidates := array_append(v_candidates, 'early_bird'); end if;
  if v_had_night_owl then v_candidates := array_append(v_candidates, 'night_owl'); end if;
  if v_had_comeback then v_candidates := array_append(v_candidates, 'comeback'); end if;
  if v_had_flawless then v_candidates := array_append(v_candidates, 'flawless'); end if;
  if coalesce((v_metrics->>'has_recurring_rest_day')::boolean, false) then
    v_candidates := array_append(v_candidates, 'rest_day_set'); end if;
  if coalesce((v_metrics->>'has_accepted_friend')::boolean, false) then
    v_candidates := array_append(v_candidates, 'not_alone'); end if;
  if coalesce((v_metrics->>'max_set_reps')::int, 0) >= 20 then
    v_candidates := array_append(v_candidates, 'rep_machine'); end if;
  if coalesce((v_metrics->>'body_weight_log_count')::int, 0) >= 5 then
    v_candidates := array_append(v_candidates, 'weight_tracked'); end if;

  -- ── 57: Consistency ────────────────────────────────────────────────────────

  -- Perfect Week: a finished Sun–Sat week with 3+ workouts where every other
  -- day was a rest day (recurring, one-off, honoring cancels/effective dates).
  if not ('perfect_week' = any (v_earned)) then
    select exists (
      select 1
        from (
          select public.grind_week_start(w.d) as ws, array_agg(w.d) as days
            from (
              select distinct local_date as d
                from sessions
               where user_id = p_user and completed_at is not null and local_date is not null
            ) w
           group by 1
          having count(*) >= 3
        ) wk
       where wk.ws + 6 <= v_today
         and not exists (
           select 1
             from generate_series(wk.ws, wk.ws + 6, interval '1 day') g(d)
            where not (g.d::date = any (wk.days))
              and not public.grind_is_rest_day(p_user, g.d::date)
         )
    ) into v_flag;
    if v_flag then v_candidates := array_append(v_candidates, 'perfect_week'); end if;
  end if;

  -- Saved It / Rest Day Pro: gaps between consecutive workout days that rest
  -- days fully bridged (grind_dates_connected — the same test the streak uses).
  if not ('saved_it' = any (v_earned) and 'rest_day_pro' = any (v_earned)) then
    select coalesce(sum(p.b - p.a - 1), 0)::int,
           coalesce(bool_or(exists (
             select 1 from user_rest_dates r
              where r.user_id = p_user and r.rest_date > p.a and r.rest_date < p.b
           )), false)
      into v_rest_bridged, v_saved
      from (
        select lag(w.d) over (order by w.d) as a, w.d as b
          from (
            select distinct local_date as d
              from sessions
             where user_id = p_user and completed_at is not null and local_date is not null
          ) w
      ) p
     where p.a is not null
       and p.b - p.a > 1
       and public.grind_dates_connected(p_user, p.a, p.b);
    if v_saved then v_candidates := array_append(v_candidates, 'saved_it'); end if;
    if v_rest_bridged >= 10 then v_candidates := array_append(v_candidates, 'rest_day_pro'); end if;
  end if;

  if not ('early_bird_regular' = any (v_earned) and 'night_owl_regular' = any (v_earned)) then
    select count(*) filter (where start_hour < 7)::int,
           count(*) filter (where start_hour >= 22)::int
      into v_push, v_pull   -- reused as plain counters
      from sessions
     where user_id = p_user and completed_at is not null and start_hour is not null;
    if v_push >= 10 then v_candidates := array_append(v_candidates, 'early_bird_regular'); end if;
    if v_pull >= 10 then v_candidates := array_append(v_candidates, 'night_owl_regular'); end if;
  end if;

  -- ── 57: Training quality ───────────────────────────────────────────────────

  if not ('warmup_ritual' = any (v_earned)) then
    select count(distinct s.id)::int into v_n
      from sessions s
      join session_logs sl on sl.session_id = s.id
     where s.user_id = p_user and s.completed_at is not null
       and coalesce(sl.is_warmup, false) = true
       and sl.weight is not null;
    if v_n >= 25 then v_candidates := array_append(v_candidates, 'warmup_ritual'); end if;
  end if;

  if not ('triple_threat' = any (v_earned)) then
    select count(*) filter (where c.cat = 'push')::int,
           count(*) filter (where c.cat = 'pull')::int,
           count(*) filter (where c.cat = 'legs')::int
      into v_push, v_pull, v_legs
      from (
        select coalesce(udc.category, s.day_type) as cat
          from sessions s
          left join user_day_categories udc
            on udc.user_id = p_user and udc.day_key = s.day_type
         where s.user_id = p_user and s.completed_at is not null
      ) c;
    if v_push >= 10 and v_pull >= 10 and v_legs >= 10 then
      v_candidates := array_append(v_candidates, 'triple_threat'); end if;
  end if;

  if not ('variety_pack' = any (v_earned)) then
    select count(distinct sl.exercise_id)::int into v_n
      from session_logs sl join sessions s on s.id = sl.session_id
     where s.user_id = p_user and s.completed_at is not null
       and sl.weight is not null
       and coalesce(sl.is_warmup, false) = false;
    if v_n >= 25 then v_candidates := array_append(v_candidates, 'variety_pack'); end if;
  end if;

  if not ('max_effort' = any (v_earned)) then
    select count(*)::int into v_n
      from session_logs sl join sessions s on s.id = sl.session_id
     where s.user_id = p_user and s.completed_at is not null
       and sl.weight is not null
       and coalesce(sl.is_warmup, false) = false
       and sl.rpe >= 10;
    if v_n >= 10 then v_candidates := array_append(v_candidates, 'max_effort'); end if;
  end if;

  -- ── 57: Progression ────────────────────────────────────────────────────────

  -- Hat Trick: PRs on 3 different exercises in one workout (several PR sets of
  -- the same lift count once).
  if not ('hat_trick' = any (v_earned)) then
    select exists (
      select 1
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = p_user and s.completed_at is not null and sl.is_pr = true
       group by sl.session_id
      having count(distinct sl.exercise_id) >= 3
    ) into v_flag;
    if v_flag then v_candidates := array_append(v_candidates, 'hat_trick'); end if;
  end if;

  if not ('podium_push' = any (v_earned)) then
    select exists (
      select 1
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = p_user and s.completed_at is not null and sl.is_pr = true
       group by date_trunc('month', coalesce(s.local_date, s.completed_at::date))
      having count(distinct sl.exercise_id) >= 5
    ) into v_flag;
    if v_flag then v_candidates := array_append(v_candidates, 'podium_push'); end if;
  end if;

  -- ── 57: Body ───────────────────────────────────────────────────────────────

  -- Daily Weigh-In: longest run of consecutive body_weights dates (gaps-and-islands).
  if not ('daily_weigh_in' = any (v_earned)) then
    select coalesce(max(run), 0)::int into v_n
      from (
        select count(*) as run
          from (
            select recorded_at - (row_number() over (order by recorded_at))::int as grp
              from body_weights where user_id = p_user
          ) x
         group by grp
      ) y;
    if v_n >= 14 then v_candidates := array_append(v_candidates, 'daily_weigh_in'); end if;
  end if;

  -- Goal Getter: out-lift the target weight (exercises.weight_target, set in
  -- the exercise editor) on 3 different exercises. Strictly above, so the
  -- prefilled target itself doesn't count.
  if not ('goal_getter' = any (v_earned)) then
    select count(*)::int into v_n
      from exercises e
     where e.user_id = p_user
       and e.weight_target is not null and e.weight_target > 0
       and exists (
         select 1 from session_logs sl join sessions s on s.id = sl.session_id
          where sl.exercise_id = e.id and s.user_id = p_user
            and s.completed_at is not null
            and coalesce(sl.is_warmup, false) = false
            and sl.weight > e.weight_target
       );
    if v_n >= 3 then v_candidates := array_append(v_candidates, 'goal_getter'); end if;
  end if;

  if not ('before_after' = any (v_earned)) then
    select count(*)::int into v_n
      from progress_photos p
      join progress_photo_groups g on g.id = p.group_id
     where g.user_id = p_user;
    if v_n >= 5 then v_candidates := array_append(v_candidates, 'before_after'); end if;
  end if;

  -- ── 57: Social ─────────────────────────────────────────────────────────────

  if not ('squad_goals' = any (v_earned)) then
    select count(*)::int into v_n
      from friendships
     where status = 'accepted'
       and (requester_id = p_user or addressee_id = p_user);
    if v_n >= 5 then v_candidates := array_append(v_candidates, 'squad_goals'); end if;
  end if;

  if not ('podium' = any (v_earned) and 'top_of_board' = any (v_earned)) then
    with board as (
      select p_user as id
      union
      select case when f.requester_id = p_user then f.addressee_id else f.requester_id end
        from friendships f
       where f.status = 'accepted'
         and (f.requester_id = p_user or f.addressee_id = p_user)
    ),
    scores as (
      select b.id, 'overall'::text as tab, coalesce(us.xp_total, 0)::numeric as v
        from board b left join user_stats us on us.user_id = b.id
      union all
      select b.id, c.cat, coalesce(max(sl.weight), 0)::numeric
        from board b
        cross join (values ('push'), ('pull'), ('legs')) c(cat)
        left join sessions s
          on s.user_id = b.id and s.completed_at is not null
        left join user_day_categories udc
          on udc.user_id = b.id and udc.day_key = s.day_type
        left join session_logs sl
          on sl.session_id = s.id
         and sl.weight is not null
         and coalesce(sl.is_warmup, false) = false
         and coalesce(udc.category, s.day_type) = c.cat
       group by b.id, c.cat
    )
    select (select count(*) from board)::int,
           min(1 + (select count(*) from scores o where o.tab = m.tab and o.v > m.v))::int
      into v_board_size, v_best_rank
      from scores m
     where m.id = p_user and m.v > 0;

    if v_best_rank is not null then
      if v_board_size >= 4 and v_best_rank <= 3 then
        v_candidates := array_append(v_candidates, 'podium'); end if;
      if v_board_size >= 3 and v_best_rank = 1 then
        v_candidates := array_append(v_candidates, 'top_of_board'); end if;
    end if;
  end if;

  -- ── 57: App & ritual ───────────────────────────────────────────────────────

  if not ('off_the_grid' = any (v_earned)) then
    select exists (
      select 1 from sessions
       where user_id = p_user and completed_at is not null and started_offline = true
    ) into v_flag;
    if v_flag then v_candidates := array_append(v_candidates, 'off_the_grid'); end if;
  end if;

  if not ('coached' = any (v_earned)) then
    select exists (
      select 1 from coach_action_proposals
       where user_id = p_user and kind = 'apply_weekly_plan' and status = 'executed'
    ) into v_flag;
    if v_flag then v_candidates := array_append(v_candidates, 'coached'); end if;
  end if;

  if not ('holiday_grind' = any (v_earned)) then
    select exists (
      select 1 from sessions
       where user_id = p_user and completed_at is not null and local_date is not null
         and public.grind_is_us_holiday(local_date)
    ) into v_flag;
    if v_flag then v_candidates := array_append(v_candidates, 'holiday_grind'); end if;
  end if;

  if v_stats.data_exported_at is not null then
    v_candidates := array_append(v_candidates, 'own_your_data'); end if;

  if not ('speak_up' = any (v_earned)) then
    select exists (select 1 from feedback where user_id = p_user) into v_flag;
    if v_flag then v_candidates := array_append(v_candidates, 'speak_up'); end if;
  end if;

  -- ── Insert ─────────────────────────────────────────────────────────────────

  foreach v_id in array v_candidates
  loop
    if not (v_id = any (v_earned)) then
      insert into user_badges (user_id, badge_id)
      values (p_user, v_id)
      on conflict do nothing;
      if found then
        v_new := array_append(v_new, v_id);
        v_earned := array_append(v_earned, v_id);
      end if;
    end if;
  end loop;

  if not ('completionist' = any (v_earned))
     and v_all_but_completionist <@ v_earned then
    insert into user_badges (user_id, badge_id)
    values (p_user, 'completionist')
    on conflict do nothing;
    if found then
      v_new := array_append(v_new, 'completionist');
    end if;
  end if;

  return to_json(v_new);
end;
$$;

-- Internal only: callable from award_earned_badges (definer) and the SQL
-- editor backfill, never directly by a client (it takes an arbitrary user id).
revoke all on function public.grind_award_badges_for(uuid) from public, anon, authenticated;

create or replace function public.award_earned_badges()
returns json
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  return public.grind_award_badges_for(auth.uid());
end;
$$;

revoke all on function public.award_earned_badges() from public, anon;
grant execute on function public.award_earned_badges() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Backfill — award every account whatever it already qualifies for.
--    Run from the SQL editor (auth.uid() is null there, which is what lets the
--    SELF_ONLY rest-day helpers evaluate another user). Re-running is a no-op.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  r record;
begin
  for r in select user_id from user_stats loop
    perform public.grind_award_badges_for(r.user_id);
  end loop;
end;
$$;

commit;

-- Record that this migration ran (needs 00-migration-tracking.sql).
insert into public.grind_migrations (version) values ('57-badge-expansion') on conflict (version) do nothing;
