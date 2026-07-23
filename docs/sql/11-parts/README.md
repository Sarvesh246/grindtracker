# `11-server-side-xp.sql`, split for the Supabase SQL editor

The full migration is ~21 KB in one file. The Supabase dashboard's SQL editor
truncates pastes that large, and because the file is mostly `$$`-quoted function
bodies, a truncated paste fails with a confusing error — e.g.
`syntax error at or near "returns"`, which is the editor having received a
fragment that begins partway through a `create function` statement.

These parts are the same SQL, split only at safe statement boundaries. Run them
**in order**, each on its own. Every part is idempotent (`create or replace`,
`add column if not exists`), so re-running one is harmless.

| Part | Contents |
| --- | --- |
| `11a-local-date-and-level.sql` | `sessions.local_date` column + backfill + index, `grind_level_for_xp()` |
| `11b-recompute.sql` | `grind_recompute_stats()` — derives xp/level/streaks/`is_pr` |
| `11c-complete-session.sql` | `grind_safe_local_date()`, `complete_session()` |
| `11d-other-rpcs.sql` | `uncomplete_session()`, `delete_session()`, `refresh_stats()`, grants |
| `11e-revoke-and-drift.sql` | **Revokes client stat writes**, seeds `user_stats`, `grind_stats_drift()` |

## ⚠️ Part 5 is the breaking one

`11e` revokes `UPDATE` on `user_stats` from `authenticated`. The moment it runs,
any **old** deployed client that writes stats directly starts failing. Run it
immediately before deploying the new code, not hours earlier.

Parts `11a`–`11d` are purely additive — they create columns and functions
nothing calls yet, so they're safe to apply well ahead of the deploy.

## After applying all five

Stats are **not** recomputed on migration; `grind_recompute_stats()` only runs
when an RPC calls it. Existing totals stay as they are until each user's next
workout completion, at which point they jump to the derived value.

To see that jump before it surprises you:

```sql
select * from grind_stats_drift();
```

Zero deltas mean the stored values already match what the logs justify. Non-zero
deltas mean they had drifted. To settle everyone deliberately rather than
mid-workout:

```sql
select grind_recompute_stats(id, current_date) from auth.users;
```

That works in the SQL editor (which runs elevated); the app can't call it —
`grind_recompute_stats` is revoked from `authenticated` on purpose.
