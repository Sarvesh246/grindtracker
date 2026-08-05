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
- `complete_session` requires ≥1 non-skipped set with weight+reps
- Transactional `upsert_past_session` (no client delete-then-insert of logs)
- Partial unique indexes: one open session per day_type; one completed per local_date+day_type
- `start_or_resume_session` atomic open-session create
- `award_earned_badges` server-side; revoke client INSERT/UPDATE/DELETE on `user_badges`
- 10-minute window for `uncomplete_session` enforced in Postgres
- `grind_dates_connected` self-only
- `get_exercise_bests` + `grind_home_history` aggregate helpers
- Owner delete policy on `feedback-images`

## Online-only PWA note

GRIND is online-only today: the installable shell (manifest) does not include a
service worker or offline workout queue. Connectivity is required to start,
log, and finish workouts. A scoped offline queue is a future enhancement, not
silently supported.

If you have multiple Supabase environments (e.g., preview + prod), run the same scripts on each.
