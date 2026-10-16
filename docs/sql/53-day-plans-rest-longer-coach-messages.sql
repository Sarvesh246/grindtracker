-- Phase 53: weekly-plan Coach action, per-exercise programmed rest, longer Coach messages
-- Idempotent. Apply AFTER 52.
--
-- 1. exercises.rest_seconds — the rest the PLAN calls for (e.g. 3 min on a heavy
--    compound, 60 s on abs). Null = no programmed rest (falls back to the
--    user's default). A rest the user picks on the timer still wins locally.
-- 2. coach_messages.content — raised from 4000 to 12000 chars so a whole
--    pasted training week fits in one message.
-- 3. coach_action_proposals.kind — adds 'apply_weekly_plan'.
--
-- Hiding a day needs no schema: a day is "disabled" when every exercise on it
-- has active = false (see enabledDayKeys in src/lib/utils/dayKeys.ts).

alter table public.exercises
  add column if not exists rest_seconds integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'exercises_rest_seconds_check'
       and conrelid = 'public.exercises'::regclass
  ) then
    alter table public.exercises
      add constraint exercises_rest_seconds_check
      check (rest_seconds is null or rest_seconds between 0 and 3600);
  end if;
end $$;

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
       and t.relname = 'coach_messages'
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ilike '%char_length%'
       and pg_get_constraintdef(c.oid) ilike '%content%'
  loop
    execute format(
      'alter table public.coach_messages drop constraint if exists %I',
      r.conname
    );
  end loop;
end $$;

alter table public.coach_messages
  drop constraint if exists coach_messages_content_len_check;
alter table public.coach_messages
  add constraint coach_messages_content_len_check
  check (char_length(btrim(content)) between 1 and 12000);

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
    'apply_weekly_plan'
  ));
