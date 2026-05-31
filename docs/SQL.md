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

Apply in order. Once `02` is in, warm-up sets are excluded from PR detection and previous-best prefill. Once `03` is in, the profile page's body-weight card starts persisting. Until `06` is applied the rotation falls back to automatic (every day once) for everyone. **`07` is required for multi-user privacy** — until it's applied, every account shares (and can edit) one exercise catalog.

If you have multiple Supabase environments (e.g., preview + prod), run the same scripts on each.
