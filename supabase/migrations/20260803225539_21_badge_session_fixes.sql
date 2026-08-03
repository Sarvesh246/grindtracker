-- Phase 21: badge session fixes
-- Idempotent. Apply AFTER 20.
--
-- Fixes two bugs surfaced by the new full-screen badge unlock overlay
-- (BadgeUnlockOverlay.tsx):
--
--   1. `award_earned_badges` was shipped in migration 20 with the param
--      `p_session_started_at timestamptz`, but the client
--      (src/lib/utils/badges.ts) has always called it with `p_start_hour`
--      (an int — the client already resolves the session's LOCAL hour via
--      `Date.getHours()`, matching this codebase's "derive dates/times in the
--      viewer's local zone" convention; see CLAUDE.md "Dates & timezones").
--      PostgREST resolves RPCs by matching argument names against the
--      function signature, so this mismatch made every call fail with
--      "function not found" — silently caught by the client, which just
--      returns `[]`. Net effect: no badge was ever awarded through this path.
--      Fixed by renaming the SQL param to match what the client already sends
--      and dropping the now-dead UTC-offset gymnastics in the body (it was
--      already fully overwritten by the final assignment, so it was dead code
--      even before this fix).
--
--   2. Undoing a finish (`uncomplete_session`, wired to ActiveWorkout's
--      "go back" on the completion modal) reopens the session and re-derives
--      stats, but any badges `award_earned_badges` had just inserted for that
--      finish stayed in `user_badges`. Re-finishing the same workout would
--      then satisfy the same conditions again but skip the insert (already
--      earned), so the badges silently never reappear even though the finish
--      that originally earned them was undone. `revoke_recent_badges` lets
--      the client name exactly the badge ids it was just shown and have them
--      deleted, scoped to the caller and to badges earned in the last 15
--      minutes (10-minute undo window + slack) so a stale/replayed call can't
--      strip long-held badges.

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. award_earned_badges — fix p_start_hour param mismatch
-- ════════════════════════════════════════════════════════════════════════════

drop function if exists award_earned_badges(timestamptz, boolean);

create or replace function award_earned_badges(
  p_start_hour int default null,
  p_had_no_skips boolean default null
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_stats user_stats%rowtype;
  v_metrics json;
  v_earned text[] := '{}';
  v_new text[] := '{}';
  v_id text;
  v_total_prs int := 0;
  v_level int := 1;
  v_had_comeback boolean := false;
  v_has_full_split boolean := false;
  v_has_weekend boolean := false;
  v_dates date[];
  v_week_start date;
  v_candidates text[] := '{}';
  v_all_but_completionist text[] := array[
    'first_workout','first_pr','streak_3','streak_7','streak_14','streak_30','streak_60',
    'workouts_10','workouts_50','workouts_100','workouts_200','workouts_365',
    'all_three_days','weekend_warrior',
    'pr_5','pr_25','pr_50','pr_100',
    'level_5','level_10','level_15','level_20',
    'volume_100k','volume_500k','volume_1m',
    'plates_225','plates_315','plates_405',
    'early_bird','night_owl','comeback','flawless',
    'rest_day_set','not_alone','rep_machine','weight_tracked'
  ];
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select * into v_stats from user_stats where user_id = v_user;
  if v_stats.user_id is null then
    return '[]'::json;
  end if;

  select coalesce(array_agg(badge_id), '{}') into v_earned
    from user_badges where user_id = v_user;

  select count(*)::int into v_total_prs
    from session_logs sl
    join sessions s on s.id = sl.session_id
   where s.user_id = v_user and sl.is_pr = true;

  v_level := grind_level_for_xp(v_stats.xp_total);

  -- Lifetime metrics (mirrors grind_badge_metrics via direct queries).
  select json_build_object(
    'total_volume', coalesce((
      select sum(sl.weight * sl.reps)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = v_user and s.completed_at is not null
         and sl.weight is not null and sl.reps is not null
         and coalesce(sl.is_warmup, false) = false
         and coalesce(sl.is_skipped, false) = false
    ), 0),
    'max_set_weight', coalesce((
      select max(sl.weight)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = v_user and s.completed_at is not null
         and sl.weight is not null
         and coalesce(sl.is_warmup, false) = false
    ), 0),
    'max_set_reps', coalesce((
      select max(sl.reps)
        from session_logs sl join sessions s on s.id = sl.session_id
       where s.user_id = v_user and s.completed_at is not null
         and sl.reps is not null
         and coalesce(sl.is_warmup, false) = false
    ), 0),
    'has_recurring_rest_day', exists (
      select 1 from user_rest_days where user_id = v_user
    ),
    'has_accepted_friend', exists (
      select 1 from friendships
       where status = 'accepted'
         and (requester_id = v_user or addressee_id = v_user)
    ),
    'body_weight_log_count', (
      select count(*)::int from body_weights where user_id = v_user
    )
  ) into v_metrics;

  -- Comeback: ≥15 calendar days between the last two distinct local_dates.
  select array_agg(d order by d desc) into v_dates
    from (
      select distinct local_date as d
        from sessions
       where user_id = v_user and completed_at is not null and local_date is not null
       order by local_date desc
       limit 2
    ) q;
  if coalesce(array_length(v_dates, 1), 0) = 2 then
    v_had_comeback := (v_dates[1] - v_dates[2]) >= 15;
  end if;

  -- Week split / weekend warrior from this ISO week (Mon–Sun), using local_date.
  v_week_start := date_trunc('week', (now() at time zone 'utc')::timestamp)::date; -- Mon in ISO

  select
    count(distinct case
      when coalesce(udc.category, s.day_type) = 'push' then 'push'
      when coalesce(udc.category, s.day_type) = 'pull' then 'pull'
      when coalesce(udc.category, s.day_type) = 'legs' then 'legs'
    end) = 3
    into v_has_full_split
    from sessions s
    left join user_day_categories udc
      on udc.user_id = v_user and udc.day_key = s.day_type
   where s.user_id = v_user
     and s.completed_at is not null
     and s.local_date is not null
     and s.local_date >= v_week_start
     and s.local_date < v_week_start + 7;

  select
    bool_or(extract(dow from s.local_date) = 0)
      and bool_or(extract(dow from s.local_date) = 6)
    into v_has_weekend
    from sessions s
   where s.user_id = v_user
     and s.completed_at is not null
     and s.local_date is not null
     and s.local_date >= v_week_start
     and s.local_date < v_week_start + 7;

  -- Build candidates.
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
  if p_start_hour is not null and p_start_hour < 7 then
    v_candidates := array_append(v_candidates, 'early_bird'); end if;
  if p_start_hour is not null and p_start_hour >= 22 then
    v_candidates := array_append(v_candidates, 'night_owl'); end if;
  if v_had_comeback then v_candidates := array_append(v_candidates, 'comeback'); end if;
  if p_had_no_skips is true then v_candidates := array_append(v_candidates, 'flawless'); end if;
  if coalesce((v_metrics->>'has_recurring_rest_day')::boolean, false) then
    v_candidates := array_append(v_candidates, 'rest_day_set'); end if;
  if coalesce((v_metrics->>'has_accepted_friend')::boolean, false) then
    v_candidates := array_append(v_candidates, 'not_alone'); end if;
  if coalesce((v_metrics->>'max_set_reps')::int, 0) >= 20 then
    v_candidates := array_append(v_candidates, 'rep_machine'); end if;
  if coalesce((v_metrics->>'body_weight_log_count')::int, 0) >= 5 then
    v_candidates := array_append(v_candidates, 'weight_tracked'); end if;

  foreach v_id in array v_candidates
  loop
    if not (v_id = any (v_earned)) then
      insert into user_badges (user_id, badge_id)
      values (v_user, v_id)
      on conflict do nothing;
      if found then
        v_new := array_append(v_new, v_id);
        v_earned := array_append(v_earned, v_id);
      end if;
    end if;
  end loop;

  -- Completionist: every other badge.
  if not ('completionist' = any (v_earned))
     and v_all_but_completionist <@ v_earned then
    insert into user_badges (user_id, badge_id)
    values (v_user, 'completionist')
    on conflict do nothing;
    if found then
      v_new := array_append(v_new, 'completionist');
    end if;
  end if;

  return to_json(v_new);
end;
$$;

revoke all on function award_earned_badges(int, boolean) from public, anon;
grant execute on function award_earned_badges(int, boolean) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. revoke_recent_badges — undo a just-awarded batch after uncomplete_session
-- ════════════════════════════════════════════════════════════════════════════

create or replace function revoke_recent_badges(p_badge_ids text[])
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_removed text[];
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  if p_badge_ids is null or array_length(p_badge_ids, 1) is null then
    return '[]'::json;
  end if;

  with removed as (
    delete from user_badges
     where user_id = v_user
       and badge_id = any (p_badge_ids)
       and earned_at > now() - interval '15 minutes'
    returning badge_id
  )
  select coalesce(array_agg(badge_id), '{}') into v_removed from removed;

  return to_json(v_removed);
end;
$$;

revoke all on function revoke_recent_badges(text[]) from public, anon;
grant execute on function revoke_recent_badges(text[]) to authenticated;

commit;
