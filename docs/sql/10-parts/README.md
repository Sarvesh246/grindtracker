# `10-leaderboard-authz.sql`, split for the Supabase SQL editor

Same reasoning as `../11-parts/README.md`: the full file is ~8.4 KB with one
large `$$`-quoted function, which the dashboard SQL editor can truncate on
paste. Split at the transaction boundary already present in the source file.

| Part | Contents |
| --- | --- |
| `10a-leaderboard-function.sql` | `get_leaderboard()` — the authorization fix itself |
| `10b-indexes-and-constraints.sql` | Supporting indexes + `session_logs` sanity CHECK constraints |

Run `10a` first, then `10b`. Both are idempotent.
