-- Part 5 of 5 of 11-server-side-xp.sql
-- REVOKE client writes, seed user_stats, grind_stats_drift()
--
-- The full migration is one ~21KB file, which the Supabase SQL editor
-- truncates mid-function. These parts are split at safe statement
-- boundaries. Run them IN ORDER, each on its own. Every part is
-- idempotent, so re-running one is harmless.
--
-- Part 5 is the one that REVOKES client stat writes — it breaks the old
-- deployed client, so run it immediately before deploying the new code.

begin;

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

commit;
