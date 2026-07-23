# GRIND — Supabase migrations

Schema changes ship as standalone SQL snippets in [docs/sql/](sql/). Apply each by pasting into the Supabase dashboard's SQL editor and running. All scripts are idempotent (`if not exists` / `add column if not exists`).

| File | Phase | What it adds |
| --- | --- | --- |
| [02-warmup-and-notes.sql](sql/02-warmup-and-notes.sql) | 2 | `session_logs.is_warmup`, `session_logs.note`, `sessions.note`, partial index for fast PR queries. |
| [03-body-weights.sql](sql/03-body-weights.sql) | 3 | `body_weights` table with RLS policy + user/date index. |
| [04-session-delete-rls.sql](sql/04-session-delete-rls.sql) | 4 | RLS `delete` policies on `sessions` and `session_logs` so discard workout works. |
| [05-user-day-categories.sql](sql/05-user-day-categories.sql) | 5 | `user_day_categories` table with RLS, and replacement `get_leaderboard` RPC with category-aware matching (explicit mapping + literal fallback for standard push/pull/legs names). |
| [06-user-rotation.sql](sql/06-user-rotation.sql) | 6 | `user_rotation` table with RLS — per-user suggested workout order (an ordered loop of day_keys that may repeat) plus the `current_index` pointer the home page advances. |
| [07-exercises-per-user.sql](sql/07-exercises-per-user.sql) | 7 | Adds `exercises.user_id` + RLS so the exercise/day catalog is private per user (previously one global catalog shared by all accounts). Backfills existing rows to the original user; new users start with a blank slate. |
| [08-flex-days.sql](sql/08-flex-days.sql) | 8 | `user_flex_days` table with RLS — days the auto-rotation skips (abs, cardio) so they never advance or appear in the suggestion. |
| [09-feedback.sql](sql/09-feedback.sql) | 9 | `feedback` table + `is_grind_admin()` predicate, the private `feedback-images` storage bucket with its policies, and the `feedback_rate_limit` BEFORE INSERT trigger (3 per 10 min, 20 per day, per user). Users insert their own feedback; only the admin account can read all of it, mark read/starred, or delete. |
| [10-leaderboard-authz.sql](sql/10-leaderboard-authz.sql) | 10 | **Security fix.** `get_leaderboard` accepted any `p_user_ids` and ran `security definer`, so any signed-in user could read any other user's stats by uuid. Now intersects the request with the caller's own id + accepted friendships, pins `search_path`, and restricts EXECUTE to `authenticated`. Adds the indexes the RPC and username search need, plus sanity CHECK constraints on `session_logs.weight`/`reps`. |
| [11-server-side-xp.sql](sql/11-server-side-xp.sql) | 11 | **Security fix.** XP/level/streak were computed in the browser and written straight to `user_stats` — anyone could set their own XP from devtools. Stats are now DERIVED server-side from `sessions` + `session_logs` by `grind_recompute_stats()`, exposed through the `complete_session` / `uncomplete_session` / `delete_session` / `refresh_stats` RPCs. Revokes client UPDATE on `user_stats` and column-restricts UPDATE on `sessions`. Adds `sessions.local_date` (streaks need the user's calendar date, not UTC) and seeds `user_stats` on signup. |

| [12-friendship-authz.sql](sql/12-friendship-authz.sql) | 12 | **Security fix.** `friendships` had one `ALL` policy testing only "am I involved in this row", so a requester could accept their own request — or insert a pre-accepted friendship naming someone else as requester. Split into per-command policies: INSERT only as yourself and only `pending`, UPDATE only by the addressee and only `pending`→`accepted`, DELETE by either party. Adds status/no-self CHECKs and a unique index per pair. Also narrows `user_profiles` SELECT from `public` (readable by `anon` with just the publishable key) to `authenticated`. |
| [13-recompute-no-temp-table.sql](sql/13-recompute-no-temp-table.sql) | 13 | **Bug fix.** `grind_recompute_stats()` built its gaps-and-islands runs in a session-local `TEMP TABLE ... ON COMMIT DROP`, which poisons the PL/pgSQL plan cache on Supabase's pooled PostgREST connections: the cached plan binds to the temp table's OID, the table is dropped at commit, and the next request on the same backend fails with `relation "_grind_runs" does not exist`. That deterministically broke **workout completion** ("Could not finish workout. Check your connection and try again." on a good connection — and the client retry can't recover a deterministic server error). Rewrites the function to compute the runs as inline CTEs (no temp table); the derivation is unchanged. Idempotent `create or replace` — just run it on any environment that already applied `11`. |

Apply in order. **`10` does not actually close the leaderboard hole until `12` is
applied** — `get_leaderboard` authorizes on `status = 'accepted'`, and until `12`
any user can mint that acceptance for themselves. **`09` must be applied before the feedback button will work** — until then, submitting fails and `/admin/feedback` shows an empty inbox. Once `02` is in, warm-up sets are excluded from PR detection and previous-best prefill. Once `03` is in, the profile page's body-weight card starts persisting. Until `06` is applied the rotation falls back to automatic (every day once) for everyone. **`07` is required for multi-user privacy** — until it's applied, every account shares (and can edit) one exercise catalog.

If you have multiple Supabase environments (e.g., preview + prod), run the same scripts on each.

## ⚠️ Deploying 10 and 11

`11` **revokes the client's ability to write `user_stats`**, and the app code in
this repo already calls the RPCs it introduces. The two must ship together:

1. Run the drift check first — it is read-only and tells you whether recomputing
   will change anyone's stored totals:
   ```sql
   -- paste only the grind_stats_drift() definition from 11, then:
   select * from grind_stats_drift();
   ```
   All-zero deltas mean applying `11` changes enforcement only. Non-zero deltas
   mean the stored values had drifted and will be corrected to what the logs
   justify.
2. Apply `10`, then `11`, then `12`.
3. Deploy the app.

**`07` may never have been applied.** A `pg_tables` dump on 2026-07-22 showed
`exercises.rowsecurity = false`, which is impossible if `07` ran to completion —
it ends with `enable row level security`. Until it is applied, the exercise
catalog has no row filtering at all: every account shares one catalog and, if
`anon` holds table grants, an unauthenticated request carrying the publishable
key can read and delete all of it. Check with:

```sql
select relrowsecurity from pg_class where relname = 'exercises';
select column_name from information_schema.columns
 where table_name='exercises' and column_name='user_id';
```

Deploying the app *before* the migrations breaks workout completion (the RPCs
won't exist). Applying `11` *before* deploying breaks it too (the old client
writes `user_stats` directly and will be denied). Keep the gap short.
