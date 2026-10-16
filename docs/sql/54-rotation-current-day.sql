-- Phase 54: anchor the rotation pointer to a day, not just a slot number
-- Idempotent. Apply AFTER 53.
--
-- user_rotation.current_index is a position in a sequence that can change
-- under it (a day added, disabled or reordered). Home used to "repair" a
-- pointer that wasn't on the last-completed day by snapping it back there —
-- which also silently undid every Skip, so the Start button kept offering the
-- day you just skipped.
--
-- current_day records which day the pointer was ON when it was written. The
-- app (resolveRotationIndex in src/lib/utils/rotation.ts) re-locates that day
-- when the sequence shifts, and otherwise trusts the pointer, so skips stick.
-- Null = legacy row or a reset to -1; the app falls back to timestamps until
-- the next write fills it in. No backfill: the effective sequence depends on
-- disabled/flex days, which the app resolves, not SQL.

alter table public.user_rotation
  add column if not exists current_day text;

notify pgrst, 'reload schema';
