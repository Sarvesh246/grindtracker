-- Phase 18: persist skipped sets across a closed/resumed workout.
-- Apply via Supabase SQL editor.
-- Idempotent: safe to re-run.
--
-- Skipping a set in an active workout only ever lived in React state, so
-- closing the app (or just losing the tab) and resuming rebuilt the workout
-- from `session_logs` alone — every skip silently reverted to "not done".
-- `is_skipped` gives Skip a row to persist: the client upserts a
-- weight=null/reps=null marker row when a set is skipped and deletes it on
-- undo, so resume can tell "skipped" apart from "never attempted". Every
-- stats RPC already filters on `weight is not null` (see grind_recompute_stats,
-- complete_session, grind_badge_metrics), so these marker rows are already
-- invisible to XP/streak/PR calculation without any RPC change — the CHECK
-- below just makes that invariant explicit and enforced.

alter table session_logs
  add column if not exists is_skipped boolean not null default false;

alter table session_logs
  drop constraint if exists session_logs_skip_implies_no_weight;
alter table session_logs
  add constraint session_logs_skip_implies_no_weight
  check (not is_skipped or (weight is null and reps is null));
