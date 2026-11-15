# Rotation, rest days, disabled days, skip persistence

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Disabled days & weekly plans (migration `53`)
A day is **disabled** when it has exercises and every one is `active=false` —
no new table. Manage → day → "Day enabled" flips them all; exercises, colors and
history stay, and re-enabling turns every exercise back on. Anything that builds
the rotation / "up next" goes through `enabledDayKeys()` (`dayKeys.ts`), so a
disabled day drops out of Log's day picker, Home, the rotation and the Coach;
Progress pickers filter the same way. History views (calendar, past log) keep
every day. Manage still lists disabled days with a DISABLED badge.

The Coach's `propose_apply_weekly_plan` installs a whole pasted week in one
confirm: per-day exercises with `exercises.rest_seconds`, a manual rotation in
Mon→Sun order (pointer set so "up next" is the next planned weekday), plan rest
weekdays via `set_rest_weekday`, and old days hidden (never deleted) except
`keepDays`. Rest resolution: session override → rest the user picked on the
timer → `rest_seconds` (registered in `restPref.registerProgrammedRest`) →
Settings default. Messages up to `COACH_MAX_MESSAGE_CHARS` (12000; keep the
`coach_messages` CHECK in `53` in sync); the `plan_install` intent gets an
8000-token output budget because the tool call carries the whole week.

## Rotation (src/lib/utils/rotation.ts)
The suggested "next day" comes from a per-user rotation — an ordered loop of day_keys
that may repeat (e.g. [push, abs, pull, abs, legs, abs]). `auto` mode derives the order
from the user's days (each once, alphabetical, via `autoSequence`) and fixes the old bug
where custom days fell out of the push→pull→legs cycle; `manual` mode follows the saved
`sequence`, editable in WorkoutManager's "Edit workout order" screen (reorderable slot
list). `home/page.tsx` reads `nextDay(effectiveSequence(row, dayKeys), current_index)`;
`ActiveWorkout.handleFinish` advances `current_index` via `advanceIndex` after a live
completion (backdated `log/past` entries deliberately don't). New rotations seed
`current_index: -1` so the first day is next (`nextDay(seq, 0)` would skip it).
The suggestion is
non-binding — DaySelect still lets you pick any day, and marks the suggested one "UP NEXT".

**One resolver, one I/O module.** Every reader of "up next" (Home's Start button,
Log's UP NEXT badge, the Coach) resolves the stored pointer with
`resolveRotationIndex` (`rotation.ts`), and every pointer write (finish, quick-save,
Skip, undo) goes through `src/lib/utils/rotationStore.ts` — never a bare
`user_rotation` upsert of `current_index`. Rules: `current_day` (migration `54`)
anchors the pointer to the day it was on, so a sequence change re-locates it; a
completion newer than the pointer's `updated_at` means the finish advance never
landed, so it's applied then. The old rule ("snap the pointer to the last-completed
day") silently undid every Skip. Home's Skip refuses if fresh state disagrees with
the day the button showed, paints the new day optimistically, and offers UNDO.
A writer that sets the index directly must set `current_day` too (`writeRotationRow`).
Helpers are pure (no Supabase import). Apply migration `06-user-rotation.sql` first
(default `-1` as of `40`).

## Rest days (src/lib/utils/restDays.ts, migrations `14` + `39` + `43`)
Two ways to declare a day off without breaking the streak: recurring weekly
rest days (toggled as day-pills in Profile → Settings, backed by
`user_rest_days`) and one-off rest dates (`user_rest_dates`). Settings pills
are the **weekly budget N** and the default schedule — they do **not** cover
today when newly turned on (`effective_from` is the next occurrence of that
weekday strictly after local today), which closes the old bypass of toggling
today's weekday in Settings to save a streak. Existing rows stay at
`effective_from = 1970-01-01`. Removing a weekday soft-ends it
(`effective_until` = local today, exclusive) instead of deleting — past
occurrences keep counting for streaks; re-adding inserts a new open-ended
interval from the next occurrence (migration `43`).

Home has a **Rest today** control under the streak card: tap to insert a
one-off for today, tap again to undo. Scheduled rest (a Settings weekday
that's already in effect) is shown but not undone from Home. The button hides
when N=0 (configure rest days first) or when they already trained today
(unless there's a one-off to undo).

A Sun–Sat week cannot have more rest days than N. An extra one-off steals a
**later** scheduled rest day that week via `user_rest_cancels` (`stolen_for`
= the one-off); undoing the one-off deletes those cancels. If nothing is left
to steal, Postgres raises `REST_BUDGET_EXCEEDED`. Example: Saturday is the
configured rest day; Rest today on Wednesday cancels this week's Saturday.
Sunday is the first day of the week (migration `48`), so a Sunday rest day
has already spent its slot by Monday.

The missed-day banner still offers to confirm a small gap as rest, but only
when the gap fits **remaining** weekly slots (`uncovered.length <= N - used`).
Once N rest days are used this week — configured weekdays or Rest today skips
— another miss breaks the streak. Server-side, `grind_dates_connected(user,
from, to)` tests whether every day strictly between two dates is a rest day
(`grind_is_rest_day`, which honors one-offs, cancels, `effective_from`, and
`effective_until`); `grind_recompute_stats()` uses it to group workout dates
into rest-day-aware "runs". `restDays.ts` mirrors the same logic in TS
(`Date.getDay()` matches `extract(dow)`, 0=Sun..6=Sat) so the client can
compute gaps and Rest today eligibility using the viewer's own local "today"
— never the server's, per Dates & timezones below. Mutate through
`toggle_rest_today` / `set_rest_weekday`; do not UPDATE
`user_rest_days.effective_from` / `effective_until` from the client. Direct
INSERT/UPDATE/DELETE on `user_rest_days` is revoked (UTC-today hole + history
wipe); `user_rest_cancels` is insert/select only so a steal row cannot be
deleted while keeping the one-off. Weekly budget N counts only active
weekdays (`effective_until` is null) whose `effective_from` is on or before
this week's Saturday.

## Skip persistence (migration `18-skip-persistence.sql`)
Skipping a set/exercise in ActiveWorkout is optimistic in React state
(`handleSkipSet`/`handleSkipExercise`), but also upserts a `session_logs` row
with `weight`/`reps` null and `is_skipped=true` — a marker, not a logged set —
so `initSession`'s resume path (closing the app and reopening it, or just a
remount) can tell "skipped" apart from "never attempted" and restore it as
skipped instead of reverting to blank. Undoing a skip
(`handleUnskipSet`/`handleUnskipExercise`) deletes the marker row. Every stats
RPC already filters on `weight is not null`, so these rows are already inert
for XP/streak/PR purposes — a CHECK constraint (`weight is null and reps is
null` whenever `is_skipped`) enforces that instead of relying on the client
to always uphold it.
