-- Phase 56: allow the Coach's "hide / show a whole workout day" action
-- Idempotent. Apply AFTER 55.
--
-- The Coach gets propose_set_day_enabled (hide or show every exercise in a day
-- at once, never deleting anything). Proposals are stored in
-- coach_action_proposals with a CHECK on `kind`, so the new kind has to be
-- allowed or the proposal insert fails and the Coach reports it couldn't save
-- the action.
--
-- This restates the full kind list (47's 14 + apply_weekly_plan from 53 + the
-- new one) so the constraint is correct no matter which earlier migration last
-- touched it.

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
    'update_notification_prefs',
    'apply_weekly_plan',
    'set_day_enabled'
  ));
