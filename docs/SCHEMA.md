# GRIND Supabase tables

Moved out of [CLAUDE.md](../CLAUDE.md) to keep that file short; its text is unchanged. Section references like "Dates & timezones" or "Units" refer to CLAUDE.md.

## Supabase Tables
- exercises — user_id, name, day_type, sets_target, reps_target, sort_order,
  active (default true). Per-user catalog (RLS, owner-only): each user builds &
  edits their own days & exercises; a new user starts with a blank slate (no
  seeded days). See migration `07-exercises-per-user.sql`. `active=false`
  disables the exercise for that day — toggled from WorkoutManager's day
  screen — without deleting it (keeps history/PR bar). ActiveWorkout's
  `initSession` and `log/past`'s `loadExercises` both filter to active
  exercises for a NEW entry, but keep any exercise the resuming/edited
  session already has logs for even if it's since been disabled since then.
  This matters most for `log/past`: an edit there deletes and re-inserts
  every one of the session's logs from what's on screen, so dropping a
  since-disabled exercise from the form would silently erase its history on
  save. ActiveWorkout never does a wholesale replace, so the same filter is
  really just about not hiding a set the user can still finish mid-session.
  See migration `17-exercise-active-flag.sql`.
- sessions — user_id, day_type, started_at, completed_at, xp_earned, note,
  source ('web' | 'watch'), avg_heart_rate, max_heart_rate, calories (watch
  only, migration `58`). Migration `59` adds hr_trace (smallint[], one sample
  per hr_step seconds from started_at; 0/null = gap), hr_step, hr_zones
  (zone floors z1..z5 + max, frozen at record time), zone_seconds (int[5]) and
  training_effect. Display and advice only: none of it feeds XP, streaks or PRs.
  Client DELETE is only for open sessions (`completed_at is null`, migration
  `40`); finished workouts go through `delete_session` so stats recompute.
- session_logs — session_id, exercise_id, set_number, weight, reps, is_pr,
  is_warmup, note, rpe (optional 1–10, migration `31`), is_skipped (default
  false). UNIQUE on (session_id, exercise_id, set_number). Client writes of
  `is_pr` are forced false by trigger; authoritative flags come from
  `grind_recompute_stats` on finish. `is_skipped` rows are markers
  (weight/reps always null, enforced by a CHECK) that let a skipped set in
  ActiveWorkout survive closing/resuming the app — see Skip persistence in [WORKOUT-LOGIC.md](WORKOUT-LOGIC.md)
  and migration `18-skip-persistence.sql`.
  Migration `58` adds source ('web' | 'watch'), entered_weight + entered_unit
  (what a watch sent; `weight` stays canonical lbs) and rest_seconds. Watch
  rows use the device's UUIDs as `sessions.id` / `session_logs.id`, which is
  what makes re-uploads idempotent ([watch-api.md](watch-api.md)).
  Migration `59` adds hr_peak, hr_end and hr_rest_drop_60 (bpm the watch saw
  for the set and the drop over the following minute of rest).
- user_stats — xp_total, level, current_streak, longest_streak,
  last_workout_date, total_workouts
- user_badges — user_id, badge_id, earned_at
- body_weights — user_id, weight, recorded_at (date). UNIQUE (user_id, recorded_at).
  One row per calendar day; `BodyWeightCard` upserts on that pair. See Body
  weight editing below.
- user_profiles — id (= auth uid), username (unique), display_name, avatar_url
- friendships — requester_id, addressee_id, status ('pending' | 'accepted')
- user_day_categories — (user_id, day_key) → category ('push'|'pull'|'legs'|'other'),
  maps custom day names to leaderboard tabs.
- user_day_colors — (user_id, day_key) → color (`#rrggbb`). Optional override for
  Log day cards, the home calendar, and past-log pills. Missing row uses the
  derived palette (named push/pull/legs, or the rotating extra pool). Picked
  from WorkoutManager’s color screen. See migration `49-user-day-colors.sql`.
- user_rotation — user_id (PK), mode ('auto'|'manual'), sequence (jsonb array of
  day_keys, may repeat), current_index (pointer to last completed slot). Drives the
  home page's suggested next day. See Rotation in [WORKOUT-LOGIC.md](WORKOUT-LOGIC.md).
- feedback — user_id, username/email (identity snapshot at submit time),
  category ('bug'|'feature'|'improvement'|'other'), message, image_paths (text[]
  of objects in the private `feedback-images` bucket), is_anonymous, is_read,
  is_starred. See Feedback in [SOCIAL-AND-PROFILE.md](SOCIAL-AND-PROFILE.md) and migration `09-feedback.sql`.
- user_rest_days — (user_id, day_of_week, effective_from) PK, recurring weekly
  rest days (0=Sun..6=Sat, matches `extract(dow)`/`Date.getDay()`), configured in
  Profile. `effective_from` (migration `39`) is the first date that weekday
  counts; new rows start the next occurrence strictly after today so Settings
  cannot cover a missed workout the same day. `effective_until` (migration `43`,
  exclusive, null = active) soft-ends a weekday when removed so past coverage
  survives schedule changes; re-enable inserts a new open-ended interval.
  user_rest_dates — (user_id, rest_date) PK, one-off rest dates (Home "Rest today",
  or the missed-day banner). user_rest_cancels — (user_id, rest_date) PK, a
  scheduled rest date given up this week because a one-off used the weekly budget
  (`stolen_for`). See Rest days in [WORKOUT-LOGIC.md](WORKOUT-LOGIC.md) and migrations `14-rest-days.sql`,
  `39-rest-day-skip.sql`, `43-rest-weekday-history.sql`.
- watch_devices — user_id, name, token_hash (SHA-256, unique), token_hint
  (last 4 chars), created_at, last_used_at, revoked_at, rl_window_start/rl_count
  (per-device rate limit). Clients can SELECT their own rows but not the hash or
  counters; writes only via `create_watch_device` / `revoke_watch_device`
  (migration `58`, [watch-api.md](watch-api.md)).
- daily_body — (user_id, local_date) PK, one watch snapshot per local day:
  bb_series / stress_series (96 × 15-min buckets from local midnight, null =
  no reading), bb_high/low/latest/wake, stress_avg, resting_hr, recovery_hours,
  steps, active_minutes, floors, spo2, vo2max, synced_at. Owner SELECT only;
  writes via the service-role `watch_upsert_daily`. Read by `src/lib/body`
  (Charge, the Today sheet), never by friend, leaderboard or share RPCs.
- rep_lab_sets — id (the set id) PK, user_id, session_id (FK → sessions, ON
  DELETE CASCADE), exercise, logged/auto reps, auto_shown, typed, corrected,
  the analyzed motion window (motion_x/y/z smallint[] milli-g at 12.5 Hz,
  steps), the counter's events timeline and diag (jsonb). Owner SELECT only;
  writes via the service-role `watch_store_rep_lab`. Tuning data for the
  watch rep counter; nothing in the app reads it (migration `66`). Migration
  `67` adds mag_x/y/z (compass, smallint[]), hr (bpm per second, smallint[])
  and beats (ms between heartbeats, int[]).
- watch_telemetry — id PK (chosen by the watch), user_id (cascade), kind
  (`unclean_exit` | `session`), at, app_version, data jsonb. App health from
  the watch: crashes with what the app was doing, per-workout battery, memory,
  counter timing and upload outcomes. Owner SELECT only; writes via the
  service-role `watch_store_telemetry`; trimmed after 365 days (migration `67`).
- body_prefs — user_id PK, coach_uses_body (default true), smart_rest (default
  false). Owner select/insert/update; toggled from Settings → Watch.
  `delete_body_data()` (authenticated) wipes the caller's daily_body rows and
  every session/set heart-rate column, keeping their switches (migration `59`).
RLS on exercises, sessions, session_logs, user_stats, user_badges, body_weights,
user_day_categories, user_day_colors, user_rotation, feedback, user_rest_days, user_rest_dates,
user_rest_cancels
(and delete policies on sessions/session_logs for discard).
`get_leaderboard(p_day_type, p_user_ids)` RPC ranks overall by XP, or
push/pull/legs by heaviest working-set lift (category-aware, security definer).
`get_friend_profile(p_user_id)` RPC (security definer, same self-or-accepted-
friend gate as `get_leaderboard`) backs the read-only friend profile view —
see Friend profiles in [SOCIAL-AND-PROFILE.md](SOCIAL-AND-PROFILE.md) and migration `19-friend-profile.sql`.

Schema migrations live in `docs/sql/` (idempotent; apply in order via the
Supabase SQL editor). See `docs/SQL.md`.

Health migration 61 adds owner-only `health_collection`, `health_connections`,
`health_ingest_batches`, `health_samples`, `sleep_sessions`,
`health_daily_summaries`, and `health_insights`. Clients have SELECT only;
`set_health_collection` is the caller-scoped collection control. Ingestion RPCs
are service-role only. `sleep_sessions` retains provider/wake dates, timezone,
revision and optional supplied intervals/totals. Detail samples use UTC
intervals, never invented timestamps from legacy 96-slot arrays.

`delete_body_data` and `delete_my_grind_data` preserve the previous implementations
through revoked internal wrappers, delete imported health records and pause
collection. Legacy physiology write guards prevent late uploads from restoring
deleted history. Explicit resume increments the generation; versioned batches
from older generations are rejected. No credentials are stored in exposed tables.
