-- Phase 19: read-only friend profile view.
-- Apply via Supabase SQL editor.
-- Idempotent: safe to re-run.
--
-- Tapping a leaderboard row now opens that person's profile — banner, streak
-- cards, lifetime stats, badges, "Grinding since <date>". `user_stats`,
-- `session_logs`, and `user_badges` are all owner-only RLS (see CLAUDE.md
-- Security model), so a new security-definer RPC is needed to expose one
-- friend's aggregates to another, gated the same way `get_leaderboard`
-- already gates its array of ids: self, or an accepted friendship either
-- direction. Everyone reachable from the leaderboard is already self-or-a-
-- friend, so this only ever actually rejects a hand-edited URL.

create or replace function get_friend_profile(p_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_visible boolean;
  v_result  json;
begin
  if v_caller is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;

  select (p_user_id = v_caller) or exists (
    select 1 from friendships f
     where f.status = 'accepted'
       and ((f.requester_id = v_caller and f.addressee_id = p_user_id)
         or (f.addressee_id = v_caller and f.requester_id = p_user_id))
  ) into v_visible;

  if not v_visible then
    raise exception 'NOT_VISIBLE: not yourself or an accepted friend' using errcode = '42501';
  end if;

  select json_build_object(
    'user_id',        up.id,
    'username',       up.username,
    'display_name',   up.display_name,
    'avatar_url',     up.avatar_url,
    'joined_at',      up.created_at,
    'xp_total',       coalesce(us.xp_total, 0),
    'level',          coalesce(us.level, 1),
    'current_streak', coalesce(us.current_streak, 0),
    'longest_streak', coalesce(us.longest_streak, 0),
    'total_workouts', coalesce(us.total_workouts, 0),
    'total_prs', (
      select count(*) from session_logs sl
        join sessions s on s.id = sl.session_id
       where s.user_id = p_user_id and s.completed_at is not null and sl.is_pr = true
    ),
    'total_sets', (
      select count(*) from session_logs sl
        join sessions s on s.id = sl.session_id
       where s.user_id = p_user_id and s.completed_at is not null
    ),
    -- Distinct LOCAL days (sessions.local_date, 11-server-side-xp.sql), not
    -- completed_at — there's no "viewer's timezone" reasoning to fall back on
    -- for someone else's calendar, so this uses the same day the friend's own
    -- streak was computed against.
    'days_active', (
      select count(distinct s.local_date) from sessions s
       where s.user_id = p_user_id and s.completed_at is not null
    ),
    'badge_ids', coalesce(
      (select json_agg(ub.badge_id) from user_badges ub where ub.user_id = p_user_id),
      '[]'::json
    )
  )
  into v_result
  from user_profiles up
  left join user_stats us on us.user_id = up.id
  where up.id = p_user_id;

  if v_result is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_result;
end;
$$;

revoke all on function get_friend_profile(uuid) from public, anon;
grant execute on function get_friend_profile(uuid) to authenticated;
