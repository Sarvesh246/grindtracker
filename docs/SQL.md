# GRIND — Supabase migrations

Schema changes ship as standalone SQL snippets in [docs/sql/](sql/). Apply each by pasting into the Supabase dashboard's SQL editor and running. All scripts are idempotent (`if not exists` / `add column if not exists`).

| File | Phase | What it adds |
| --- | --- | --- |
| [02-warmup-and-notes.sql](sql/02-warmup-and-notes.sql) | 2 | `session_logs.is_warmup`, `session_logs.note`, `sessions.note`, partial index for fast PR queries. |
| [03-body-weights.sql](sql/03-body-weights.sql) | 3 | `body_weights` table with RLS policy + user/date index. |

Apply in order. Once `02` is in, warm-up sets are excluded from PR detection and previous-best prefill. Once `03` is in, the profile page's body-weight card starts persisting.

If you have multiple Supabase environments (e.g., preview + prod), run the same scripts on each.
