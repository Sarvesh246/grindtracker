-- Phase 48: rest / "this week" starts on Sunday
-- Idempotent. Apply AFTER 43 (replaces grind_week_start from 39).
--
-- Paste this whole file into the Supabase SQL editor.
--
-- grind_week_start was Monday (ISO), so a Wednesday Rest today could steal
-- this week's upcoming Sunday. Weeks are now Sunday–Saturday: the budget
-- resets Sunday morning (viewer's local date), Home "workouts this week"
-- matches Rest today remaining, and a midweek skip steals a *later* rest
-- day this week (e.g. Saturday) — an already-elapsed Sunday has already
-- spent its slot.

create or replace function public.grind_week_start(p_date date)
returns date
language sql
immutable
strict
set search_path = public
as $$
  select p_date - extract(dow from p_date)::int;
$$;

comment on function public.grind_week_start(date) is
  'Sunday of the week containing p_date (0=Sun). Rest budget and Home this-week stats.';
