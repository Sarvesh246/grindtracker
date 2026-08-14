-- Phase 47: expand coach_action_proposals.kind for confirm-before-apply tools
-- (tracked copy of docs/sql/47-coach-action-kinds.sql)
-- Idempotent. Apply AFTER 46.
--
-- Coach can propose 11 additional mutations that already exist as RPCs or
-- direct table writes in the manual UI. This only widens the CHECK on
-- coach_action_proposals.kind — no new RPCs, tables, or RLS.

do $$
declare
  r record;
begin
  for r in
    select c.conname
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and t.relname = 'coach_action_proposals'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%kind%'
  loop
    execute format(
      'alter table public.coach_action_proposals drop constraint if exists %I',
      r.conname
    );
  end loop;
end $$;

alter table public.coach_action_proposals
  add constraint coach_action_proposals_kind_check
  check (kind in (
    'correct_weights',
    'start_workout',
    'create_day',
    'log_body_weight',
    'delete_body_weight',
    'finish_workout',
    'undo_finish_workout',
    'skip_sets',
    'toggle_rest_today',
    'set_rest_weekday',
    'edit_exercise',
    'update_rotation',
    'edit_session_log',
    'update_notification_prefs'
  ));
