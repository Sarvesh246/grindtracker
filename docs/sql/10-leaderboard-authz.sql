-- Phase 10: lock down the leaderboard RPC + data sanity constraints.
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ---------------
-- `get_leaderboard` is `security definer`, so it reads `user_profiles`,
-- `user_stats`, `sessions` and `session_logs` with RLS BYPASSED. Until now it
-- also accepted an arbitrary `p_user_ids uuid[]` from the client and trusted it
-- completely. The browser politely passes `[me, ...my friends]`, but nothing
-- forced that: any authenticated user could POST straight to
-- `/rest/v1/rpc/get_leaderboard` with any UUIDs and read back that person's
-- username, avatar, XP, level, streak, workout count and heaviest lift.
-- Combined with username search (which returns profiles by substring) that is a
-- full scrape of the user table and social graph.
--
-- The fix: the function now intersects the requested ids with the caller's OWN
-- id plus their ACCEPTED friendships. Passing a stranger's uuid returns nothing
-- instead of their stats. The client keeps working unchanged — it was already
-- only ever asking for ids it was entitled to.
--
-- Also pins `search_path` (Supabase's linter flags `security definer` functions
-- without it as `function_search_path_mutable` — a definer function that
-- resolves unqualified names through a caller-controlled search_path can be
-- tricked into executing attacker-owned objects), and restricts EXECUTE to
-- authenticated so `anon` can't call it at all.

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

-- ── Supporting indexes ──────────────────────────────────────────────────────
-- The authorization CTE runs on every leaderboard call, and the category branch
-- aggregates every completed session of every friend. Without these the RPC is
-- a sequential scan that gets linearly worse as the user base grows.

create index if not exists friendships_requester_idx
  on friendships (requester_id, status);
create index if not exists friendships_addressee_idx
  on friendships (addressee_id, status);
create index if not exists sessions_user_completed_idx
  on sessions (user_id, completed_at desc) where completed_at is not null;
create index if not exists session_logs_session_idx
  on session_logs (session_id);
-- Username search (`ilike '%q%'`) can't use a btree index; trigram can.
create extension if not exists pg_trgm;
create index if not exists user_profiles_username_trgm_idx
  on user_profiles using gin (username gin_trgm_ops);

-- ── Data sanity constraints ─────────────────────────────────────────────────
-- Weights and reps are self-reported, so they can never be fully trusted — but
-- they can be kept inside physically plausible bounds so one troll can't park a
-- 10,000 lb bench at the top of every leaderboard forever. Values are canonical
-- POUNDS (see CLAUDE.md → Units).
--
-- Guarded by a DO block: if existing rows already violate these, the ALTER would
-- fail and abort the whole migration. Instead we skip and warn, so you can clean
-- up and re-run.

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'session_logs_weight_sane'
  ) then
    begin
      alter table session_logs
        add constraint session_logs_weight_sane
        check (weight is null or (weight >= 0 and weight <= 2000));
    exception when check_violation then
      raise warning 'Skipped session_logs_weight_sane: existing rows are out of range (0-2000 lbs). Clean them up and re-run.';
    end;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'session_logs_reps_sane'
  ) then
    begin
      alter table session_logs
        add constraint session_logs_reps_sane
        check (reps is null or (reps >= 0 and reps <= 1000));
    exception when check_violation then
      raise warning 'Skipped session_logs_reps_sane: existing rows are out of range (0-1000 reps). Clean them up and re-run.';
    end;
  end if;
end $$;
