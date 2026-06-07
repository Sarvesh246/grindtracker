-- Phase 8: flex days — workout days excluded from the auto-rotation suggestion.
-- Idempotent: safe to re-run.
--
-- A flex day is one the user wants to do opportunistically (e.g. abs, cardio)
-- without it advancing or appearing in the rotation. Presence in this table means
-- the day is flex. In auto mode the rotation skips flex days; in manual mode the
-- user controls the sequence directly.

create table if not exists user_flex_days (
  user_id  uuid not null references auth.users(id) on delete cascade,
  day_key  text not null,
  primary key (user_id, day_key)
);

alter table user_flex_days enable row level security;

drop policy if exists "own flex days" on user_flex_days;
create policy "own flex days"
  on user_flex_days for all
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);
