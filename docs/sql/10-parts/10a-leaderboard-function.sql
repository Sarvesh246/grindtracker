-- Part 1 of 2 of 10-leaderboard-authz.sql
-- get_leaderboard() itself — the authorization fix.
--
-- Split from 10-leaderboard-authz.sql because the Supabase SQL editor
-- truncates large pastes; this part is idempotent and safe to re-run.

begin;

drop function if exists get_leaderboard(text, uuid[]);

create or replace function get_leaderboard(
  p_day_type text,     -- 'push' | 'pull' | 'legs' | 'overall'
  p_user_ids uuid[]
)
returns table (
  user_id        uuid,
  username       text,
  display_name   text,
  avatar_url     text,
  xp_total       bigint,
  level          int,
  current_streak int,
  total_workouts int,
  best_lift      numeric
)
language sql stable security definer
set search_path = public
as $$
  -- ── Authorization gate ───────────────────────────────────────────────────
  -- The set of users the CALLER is allowed to see: themselves, plus anyone they
  -- have an accepted friendship with (in either direction). Everything below
  -- reads from `visible`, never from `p_user_ids` directly, so an unauthorized
  -- uuid in the request is silently dropped rather than honoured.
  with visible as (
    select auth.uid() as id
    where auth.uid() is not null
    union
    select case
             when f.requester_id = auth.uid() then f.addressee_id
             else f.requester_id
           end
    from friendships f
    where f.status = 'accepted'
      and (f.requester_id = auth.uid() or f.addressee_id = auth.uid())
  ),
  requested as (
    select v.id
    from visible v
    where v.id = any(p_user_ids)
  )
  select * from (

    -- ── OVERALL branch ─────────────────────────────────────────────────────
    select
      up.id                              as user_id,
      up.username,
      up.display_name,
      up.avatar_url,
      coalesce(us.xp_total, 0)::bigint   as xp_total,
      coalesce(us.level, 1)::int         as level,
      coalesce(us.current_streak, 0)::int as current_streak,
      coalesce(us.total_workouts, 0)::int as total_workouts,
      0::numeric                         as best_lift
    from user_profiles up
    left join user_stats us on us.user_id = up.id
    where up.id in (select id from requested)
      and p_day_type = 'overall'

    union all

    -- ── PUSH / PULL / LEGS branch ───────────────────────────────────────────
    -- A session counts for a category when:
    --   a) An explicit mapping exists (udc_match is not null), OR
    --   b) No mapping at all for that day_key (udc_any is null) AND day_type = category
    select
      up.id                              as user_id,
      up.username,
      up.display_name,
      up.avatar_url,
      coalesce(us.xp_total, 0)::bigint   as xp_total,
      coalesce(us.level, 1)::int         as level,
      coalesce(us.current_streak, 0)::int as current_streak,
      coalesce(us.total_workouts, 0)::int as total_workouts,
      coalesce(
        max(sl.weight) filter (where sl.weight is not null and sl.is_warmup = false),
        0
      )::numeric                         as best_lift
    from user_profiles up
    left join user_stats us
      on us.user_id = up.id
    left join sessions s
      on  s.user_id = up.id
      and s.completed_at is not null
    left join user_day_categories udc_match
      on  udc_match.user_id = up.id
      and udc_match.day_key = s.day_type
      and udc_match.category = p_day_type
    left join user_day_categories udc_any
      on  udc_any.user_id = up.id
      and udc_any.day_key = s.day_type
    left join session_logs sl
      on  sl.session_id = s.id
      and (
        udc_match.user_id is not null
        or (
          udc_any.user_id is null
          and s.day_type = p_day_type
        )
      )
    where up.id in (select id from requested)
      and p_day_type <> 'overall'
    group by
      up.id, up.username, up.display_name, up.avatar_url,
      us.xp_total, us.level, us.current_streak, us.total_workouts

  ) results
  order by
    case when p_day_type = 'overall' then xp_total::numeric else best_lift end desc
$$;

-- Only signed-in users may call it. `anon` holding the publishable key must not.
revoke all on function get_leaderboard(text, uuid[]) from public, anon;
grant execute on function get_leaderboard(text, uuid[]) to authenticated;

commit;
