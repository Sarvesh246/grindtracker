-- Phase 5: per-user day → leaderboard category mapping
-- Idempotent: safe to re-run.

-- ── Table ──────────────────────────────────────────────────────────────────

create table if not exists user_day_categories (
  user_id    uuid    not null references auth.users(id) on delete cascade,
  day_key    text    not null,
  category   text    not null check (category in ('push','pull','legs','other')),
  created_at timestamptz not null default now(),
  primary key (user_id, day_key)
);

alter table user_day_categories enable row level security;

drop policy if exists "own day categories" on user_day_categories;
create policy "own day categories"
  on user_day_categories for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create index if not exists user_day_categories_user_idx
  on user_day_categories (user_id);

-- ── Replacement RPC ───────────────────────────────────────────────────────
-- Resolution rule:
--   1. If (user_id, day_key) row exists in user_day_categories → use that category
--   2. If NO row exists for (user_id, day_key) → fall back to literal day_type = category
--      This keeps existing users with standard push/pull/legs names working with no migration.

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
language sql stable security definer as $$
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
    where up.id = any(p_user_ids)
      and p_day_type = 'overall'

    union all

    -- ── PUSH / PULL / LEGS branch ───────────────────────────────────────────
    -- A session counts for a category when:
    --   a) An explicit mapping exists (udc_match is not null), OR
    --   b) No mapping at all for that day_key (udc_any is null) AND day_type = category (literal fallback)
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
    -- Explicit mapping row matching the requested category
    left join user_day_categories udc_match
      on  udc_match.user_id = up.id
      and udc_match.day_key = s.day_type
      and udc_match.category = p_day_type
    -- Any mapping row for this user+day_key (used to detect "no mapping" for fallback)
    left join user_day_categories udc_any
      on  udc_any.user_id = up.id
      and udc_any.day_key = s.day_type
    -- Logs: only pulled in for sessions that match the category resolution rule
    left join session_logs sl
      on  sl.session_id = s.id
      and (
        udc_match.user_id is not null        -- explicit mapping matches
        or (
          udc_any.user_id is null            -- no mapping row at all
          and s.day_type = p_day_type        -- literal fallback
        )
      )
    where up.id = any(p_user_ids)
      and p_day_type <> 'overall'
    group by
      up.id, up.username, up.display_name, up.avatar_url,
      us.xp_total, us.level, us.current_streak, us.total_workouts

  ) results
  order by
    case when p_day_type = 'overall' then xp_total::numeric else best_lift end desc
$$;
