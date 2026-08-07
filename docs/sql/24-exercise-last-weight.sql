-- Phase 24: last-used weight per exercise (distinct from all-time best).
-- Idempotent: safe to re-run.
--
-- WHY THIS EXISTS
-- ----------------
-- ActiveWorkout's "prev: X lbs" hint and its weight-input prefill were both
-- sourced from get_exercise_bests (20-production-hardening.sql), which returns
-- the all-time max weight ever logged for the exercise. That reads as "what I
-- lifted last time" but isn't — after a deload or a lighter session, "prev"
-- kept showing the old all-time-best weight instead of the weight actually
-- used in the most recent session. get_exercise_bests / max_volume still back
-- the live PR bar-to-beat (is_pr detection stays all-time-volume-based, see
-- 15-volume-based-prs.sql) — only the "prev" display/prefill switches sources.
--
-- Returns, per exercise, the heaviest working-set weight logged in the user's
-- most recent completed session that touched that exercise (not the heaviest
-- ever) — i.e. what "last time" actually looked like.

create or replace function get_exercise_last_weights(p_exercise_ids uuid[])
returns table (
  exercise_id uuid,
  last_weight numeric
)
language sql
stable
security invoker
set search_path = public
as $$
  with last_session as (
    select distinct on (sl.exercise_id)
           sl.exercise_id,
           sl.session_id
      from session_logs sl
      join sessions s on s.id = sl.session_id
     where sl.exercise_id = any (p_exercise_ids)
       and s.user_id = auth.uid()
       and s.completed_at is not null
       and coalesce(sl.is_warmup, false) = false
       and coalesce(sl.is_skipped, false) = false
       and sl.weight is not null
       and sl.reps is not null
     order by sl.exercise_id, s.completed_at desc
  )
  select ls.exercise_id, max(sl.weight) as last_weight
    from last_session ls
    join session_logs sl
      on sl.session_id = ls.session_id
     and sl.exercise_id = ls.exercise_id
   where coalesce(sl.is_warmup, false) = false
     and coalesce(sl.is_skipped, false) = false
     and sl.weight is not null
   group by ls.exercise_id;
$$;

revoke all on function get_exercise_last_weights(uuid[]) from public, anon;
grant execute on function get_exercise_last_weights(uuid[]) to authenticated;
