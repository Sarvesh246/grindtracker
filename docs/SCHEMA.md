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
- sessions — user_id, day_type, started_at, completed_at, xp_earned, note.
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
