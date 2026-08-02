-- Phase 16: badge-metrics RPC for the expanded badge set.
-- Idempotent: safe to re-run. Apply after 15-volume-based-prs.sql.
--
-- WHY THIS EXISTS
-- ---------------
-- The badge set grew from 14 to 35, adding categories that need aggregates
-- `checkAndAwardBadges()` couldn't cheaply compute client-side: lifetime
-- volume (100K/500K/1M Club), a single set's heaviest weight (plate-count
-- badges) and highest reps, how many distinct exercises have ever been
-- logged, whether a recurring rest day is configured, whether an accepted
-- friendship exists, and how many body-weight entries exist. Reading enough
-- rows client-side to derive these would mean pulling a user's entire
-- session_logs history on every single workout finish.
--
-- THE APPROACH
-- ------------
-- One RPC, one round trip, one JSON object with everything the new badge
-- conditions need beyond what's already available (session_logs.is_pr count,
-- user_stats, the day-of-week set for weekend_warrior, the last two workout
-- dates for the comeback badge — those stay as plain client-side queries in
-- badges.ts since they're already cheap single-table reads).
--
-- Not security definer: every subquery filters on `auth.uid()` directly (not
-- a parameter), so it can only ever report the caller's own data, and it runs
-- under the caller's normal RLS-scoped privileges — no elevated access
-- needed, nothing to revoke from `anon`/`public` beyond the default.

begin;

create or replace function grind_badge_metrics()
returns json
language sql
stable
set search_path = public
as $$
  select json_build_object(
    'total_volume', coalesce((
      select sum(sl.weight * sl.reps)
        from session_logs sl
        join sessions s on s.id = sl.session_id
       where s.user_id = auth.uid()
         and s.completed_at is not null
         and sl.is_warmup = false
         and sl.weight is not null
         and sl.reps is not null
    ), 0),
    'max_set_weight', coalesce((
      select max(sl.weight)
        from session_logs sl
        join sessions s on s.id = sl.session_id
       where s.user_id = auth.uid()
         and s.completed_at is not null
         and sl.is_warmup = false
         and sl.weight is not null
    ), 0),
    'max_set_reps', coalesce((
      select max(sl.reps)
        from session_logs sl
        join sessions s on s.id = sl.session_id
       where s.user_id = auth.uid()
         and s.completed_at is not null
         and sl.is_warmup = false
         and sl.reps is not null
    ), 0),
    'unique_exercise_count', coalesce((
      select count(distinct sl.exercise_id)
        from session_logs sl
        join sessions s on s.id = sl.session_id
       where s.user_id = auth.uid()
         and s.completed_at is not null
    ), 0),
    'has_recurring_rest_day', exists(
      select 1 from user_rest_days where user_id = auth.uid()
    ),
    'has_accepted_friend', exists(
      select 1 from friendships
       where status = 'accepted'
         and (requester_id = auth.uid() or addressee_id = auth.uid())
    ),
    'body_weight_log_count', (
      select count(*) from body_weights where user_id = auth.uid()
    )
  );
$$;

revoke all on function grind_badge_metrics() from public, anon;
grant execute on function grind_badge_metrics() to authenticated;

commit;
