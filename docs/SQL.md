# GRIND — Supabase migrations

Schema changes ship as standalone SQL snippets in [docs/sql/](sql/). Apply each by pasting into the Supabase dashboard's SQL editor and running. All scripts are idempotent (`if not exists` / `add column if not exists`).

> **Production-critical:** After pulling code that references new RPCs, always
> apply the matching SQL file **before** (or immediately with) the app deploy.
> Migration **20** hardens stats/badges/session writes and **revokes** direct
> client mutations the old code relied on — the app and SQL must ship together.

Tracked copies also live under `supabase/migrations/` for CLI-based environments
(`supabase db push` / linked projects). The numbered files in `docs/sql/` remain
the authoritative, dashboard-pasteable source of truth until the remote project
is fully linked to migration history.

| File | Phase | What it adds |
| --- | --- | --- |
| [02-warmup-and-notes.sql](sql/02-warmup-and-notes.sql) | 2 | Warm-up/notes columns |
| [03-body-weights.sql](sql/03-body-weights.sql) | 3 | Body weights table |
| [04-session-delete-rls.sql](sql/04-session-delete-rls.sql) | 4 | Session delete RLS |
| [05-user-day-categories.sql](sql/05-user-day-categories.sql) | 5 | Day categories + leaderboard |
| [06-user-rotation.sql](sql/06-user-rotation.sql) | 6 | Workout rotation |
| [07-exercises-per-user.sql](sql/07-exercises-per-user.sql) | 7 | Per-user exercise catalog |
| [08-flex-days.sql](sql/08-flex-days.sql) | 8 | Flex days |
| [09-feedback.sql](sql/09-feedback.sql) | 9 | Feedback + admin inbox |
| [10-leaderboard-authz.sql](sql/10-leaderboard-authz.sql) | 10 | Leaderboard authz |
| [11-server-side-xp.sql](sql/11-server-side-xp.sql) | 11 | Server-derived XP/streak |
| [12-friendship-authz.sql](sql/12-friendship-authz.sql) | 12 | Friendship authz |
| [13-recompute-no-temp-table.sql](sql/13-recompute-no-temp-table.sql) | 13 | Recompute temp-table fix |
| [14-rest-days.sql](sql/14-rest-days.sql) | 14 | Rest-day streak logic |
| [15-volume-based-prs.sql](sql/15-volume-based-prs.sql) | 15 | Volume-based PRs |
| [16-badge-metrics.sql](sql/16-badge-metrics.sql) | 16 | Badge metrics RPC |
| [17-exercise-active-flag.sql](sql/17-exercise-active-flag.sql) | 17 | Exercise active flag |
| [18-skip-persistence.sql](sql/18-skip-persistence.sql) | 18 | Skip markers |
| [19-friend-profile.sql](sql/19-friend-profile.sql) | 19 | Friend profile RPC |
| [20-production-hardening.sql](sql/20-production-hardening.sql) | 20 | **Security / integrity hardening** (see below) |
| [21-progress-photos.sql](sql/21-progress-photos.sql) | 21 | Progress photos (private, self-only) |
| [22-onboarding-state.sql](sql/22-onboarding-state.sql) | 22 | Server-side onboarding "seen" state |
| [23-tooltip-skip.sql](sql/23-tooltip-skip.sql) | 23 | "Skip tips" opt-out for contextual tooltips |
| [24-exercise-last-weight.sql](sql/24-exercise-last-weight.sql) | 24 | Last-used (not all-time-best) weight per exercise |
| [25-exercise-weight-target.sql](sql/25-exercise-weight-target.sql) | 25 | Per-exercise default weight to prefill fresh sets |
| [26-friend-profile-total-sets-fix.sql](sql/26-friend-profile-total-sets-fix.sql) | 26 | Fix `get_friend_profile` total_sets to exclude skipped sets |
| [27-web-push.sql](sql/27-web-push.sql) | 27 | Web Push subscriptions, prefs, scheduled notifications + cron RPCs |
| [28-web-push-hardening.sql](sql/28-web-push-hardening.sql) | 28 | Claim CTE join, `sent_at` client lock, `upsert_push_subscription` |
| [29-complete-session-all-prs.sql](sql/29-complete-session-all-prs.sql) | 29 | Completion modal lists every PR set (not one-per-exercise) |
| [30-notification-edge-fixes.sql](sql/30-notification-edge-fixes.sql) | 30 | Streak reminder catch-up, skip open sessions, timezone safety |
| [31-is-pr-guard-rpe-delete.sql](sql/31-is-pr-guard-rpe-delete.sql) | 31 | Ignore client `is_pr`, optional `rpe`, `delete_my_grind_data` RPC |
| [32-setup-completed.sql](sql/32-setup-completed.sql) | 32 | First-run setup wizard gate (`setup_completed_at`) |
| [33-coach.sql](sql/33-coach.sql) | 33 | Coach chat log + per-user Gemini rate limits |
| [34-coach-quota-fixes.sql](sql/34-coach-quota-fixes.sql) | 34 | Refund quota for failed Coach turns + admin dev-unlimited toggle |
| [35-coach-conversations.sql](sql/35-coach-conversations.sql) | 35 | Saved Coach chats (`coach_conversations` + message link) |
| [36-coach-actions.sql](sql/36-coach-actions.sql) | 36 | Coach action proposals (confirm-before-apply mutations) |
| [37-coach-correct-weights.sql](sql/37-coach-correct-weights.sql) | 37 | In-place Coach weight corrections (preserve skips + RPE) |
| [38-schema-integrity.sql](sql/38-schema-integrity.sql) | 38 | **Paste this in Supabase.** Badge RPC no longer trusts client hour/skips; past-date UTC+1 slack; Coach recompute uses today; delete-my-data clears Coach; comeback = 14+ days |
| [39-rest-day-skip.sql](sql/39-rest-day-skip.sql) | 39 | Home Rest today, weekly rest budget, Settings `effective_from` |
| [40-integrity-followups.sql](sql/40-integrity-followups.sql) | 40 | **Paste this in Supabase.** Warm-up-only sessions cannot complete; completed session/log writes locked; rest-cancel steal rows insert-only; rotation seed `-1`; Coach assistant insert RPC |
| [41-upsert-past-session-skip.sql](sql/41-upsert-past-session-skip.sql) | 41 | **Paste this in Supabase.** Past-edit round-trips skips, warm-ups, notes, and RPE via `upsert_past_session` |
| [42-rest-today-undo.sql](sql/42-rest-today-undo.sql) | 42 | **Paste this in Supabase.** Rest-today undo must be able to clear steal rows (`user_rest_cancels` DELETE is revoked; trigger is SECURITY DEFINER) |
| [43-rest-weekday-history.sql](sql/43-rest-weekday-history.sql) | 43 | **Paste this in Supabase.** Soft-end rest weekdays (`effective_until`) so schedule changes do not erase past streak coverage |
| [44-coach-rate-limit-lock.sql](sql/44-coach-rate-limit-lock.sql) | 44 | Per-user advisory lock in `enforce_coach_rate_limit` to close a TOCTOU race that let concurrent requests exceed the burst/daily Coach quota |

See also [PUSH.md](PUSH.md) for VAPID keys, Vercel env, and cron setup.
See [COACH.md](COACH.md) for Gemini env, rate limits, `/api/coach/chat`, and
confirm-before-apply Coach actions (`docs/sql/36-coach-actions.sql`).

**If you already applied an older 27:** run **28** next. Fresh installs can apply the
updated **27** alone (includes the hardening) or 27 then 28 (idempotent).

## Deploying 38

`38-schema-integrity.sql` must be applied **before** (or with) the app that
calls `award_earned_badges()` with no args and `complete_session(..., p_start_hour)`.

1. Run `docs/sql/38-schema-integrity.sql` in the Supabase SQL editor.
   If a previous attempt failed with `SESSION_COMPLETION_FIELDS_FORBIDDEN`,
   the transaction rolled back — run `rollback;` if the editor says it is
   aborted, then paste the **current** 38 (the start_hour backfill now sets
   `grind.allow_session_complete`, same as `complete_session`).
2. Sanity checks:
   - `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname = 'award_earned_badges';` — includes a zero-arg overload
   - `select grind_safe_past_date(current_date + 1);` — returns UTC today or UTC+1, not rewritten further back
3. Deploy the app.

**Rest-today skip (39):** paste and run `docs/sql/39-rest-day-skip.sql` **before**
deploying the app that shows Rest today on Home / calls `toggle_rest_today`.
If schema-integrity **38** was already applied on that project, still run 39
after it (39 is numbered past 38 on purpose). The file is two transactions so
it does not deadlock against in-flight streak RPCs (`40P01` on
`user_rest_days` + `user_rest_dates`). If the SQL editor still wraps the paste
as one transaction and you get a deadlock, run each `begin`/`commit` half as
its own editor run — both halves are idempotent.

**Integrity follow-ups (40):** paste and run `docs/sql/40-integrity-followups.sql`
**after** 38 and 39, **before** (or with) the app that calls
`grind_insert_coach_assistant` and treats warm-up-only sessions as unfinished.
Sanity checks:

- Completing a session that only has `is_warmup` sets raises `NO_WORKING_SETS`
- Direct `DELETE` of a completed session is rejected by RLS
- `select proname from pg_proc where proname = 'grind_insert_coach_assistant';`

**Past-edit skip + RPE fidelity (41):** paste and run `docs/sql/41-upsert-past-session-skip.sql`
**before** (or with) the app that round-trips warm-ups, skip markers, notes, and RPE on
`/log/past` edits. Without it, skip markers and RPE are silently dropped on save.
Signature of `upsert_past_session` is unchanged; JSON row shape gains `is_skipped` and
optional `rpe`. Sanity check: saving a past edit that includes a skip-marker row
(`is_skipped: true`, null weight/reps) keeps that row after reload, and existing
RPE values survive a weight-only edit.

**Rest-today undo (42):** paste and run `docs/sql/42-rest-today-undo.sql` **before**
(or with) the app that lets Home undo Rest today. 40 already intended this
(`grind_guard_rest_date_delete` as SECURITY DEFINER); 42 re-asserts it and
clears steal rows inside `toggle_rest_today` itself. Without it, undoing a
one-off rest day can fail with permission denied on `user_rest_cancels`.

## Deploying 20

`20-production-hardening.sql` must be applied before the app that consumes it.

1. Run `docs/sql/20-production-hardening.sql` in the Supabase SQL editor.
2. Sanity checks:
   - `select * from grind_stats_drift();` — non-admin fails with `ADMIN_REQUIRED`
   - Completing with zero working sets raises `NO_WORKING_SETS`
   - Direct insert of a completed session is rejected by the session write guard
3. Deploy the app.
4. In Supabase Auth dashboard → enable **Leaked password protection** (project setting; not in SQL).

### What 20 changes

- Admin-only `grind_stats_drift`
- `complete_session` requires ≥1 non-skipped **working** set with weight+reps (warm-ups excluded as of **40**)
- Transactional `upsert_past_session` (no client delete-then-insert of logs)
- Partial unique indexes: one open session per day_type; one completed per local_date+day_type
- `start_or_resume_session` atomic open-session create
- `award_earned_badges` server-side; revoke client INSERT/UPDATE/DELETE on `user_badges` (live signature is zero-arg as of **38**)
- 10-minute window for `uncomplete_session` enforced in Postgres
- `grind_dates_connected` self-only
- `get_exercise_bests` + `grind_home_history` aggregate helpers
- Owner delete policy on `feedback-images`

## PWA / service worker note

GRIND ships a minimal service worker (`public/sw.js`) for an offline shell page
and Web Push handlers. Live set writes that fail after retries are queued in
`localStorage` (`offlineQueue.ts`) and flushed on reconnect / before finish.
Starting a session and calling `complete_session` still require connectivity.
Apply migration **27** (and **28** if needed) and set VAPID / `CRON_SECRET` /
`SUPABASE_SERVICE_ROLE_KEY` before relying on
push (see [PUSH.md](PUSH.md)). If an older 27 was already applied, run **28** as well.
