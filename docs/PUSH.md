# Web Push / notifications

Lock-screen rest-end alerts, hybrid workout status cards, and evening streak
reminders. Schema: [sql/27-web-push.sql](sql/27-web-push.sql).

## Apply SQL first

Paste and run `docs/sql/27-web-push.sql` in the Supabase SQL editor **before**
deploying an app build that calls the new tables/RPCs. If you already applied an
older 27, also run `docs/sql/28-web-push-hardening.sql` (claim CTE, `sent_at`
RLS lock, `upsert_push_subscription` for endpoint ownership transfer).

## Generate VAPID keys

```bash
npx web-push generate-vapid-keys
```

## Vercel / local env

| Variable | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Client + server | Public key from generate |
| `VAPID_PRIVATE_KEY` | Server only | Private key — never expose to client |
| `VAPID_SUBJECT` | Server only | `mailto:you@example.com` (or HTTPS contact URL) |
| `CRON_SECRET` | Server only | Bearer token for `/api/cron/notifications` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Cron claims due rows via service role |

Locally, put the same keys in `.env.local`.

## Cron

[`vercel.json`](../vercel.json) registers **24 once-daily crons** (one per UTC
hour), all hitting `/api/cron/notifications`. Hobby forbids a single expression
that runs more than once per day (`*/15` fails the build), but allows up to 100
daily jobs — so this fan-out gives roughly hourly coverage on Hobby with no
external service and no Pro upgrade.

Each invocation:

1. Calls `schedule_streak_reminders()` (migration **30**: catch-up if the exact
   hour was missed, skip open sessions / invalid timezones).
2. Claims due `scheduled_notifications` via `claim_due_notifications()`.
3. Sends each via `web-push`. Auth: `Authorization: Bearer $CRON_SECRET`
   (Vercel injects this for its own crons).
4. Best-effort prune of old sent/cancelled rows (`grind_prune_scheduled_notifications`).

**Streak reminders:** when your local clock hits the chosen hour (17–21), the
matching UTC-hour job picks you up that day; later hours catch up if that job
failed. Hobby may fire anywhere in that UTC hour (±59 min).
`unique(dedupe_key)` keeps it to one ping per local day. Copy is a rotating
pool of 8 motivating variants (stable per user+local date) — applied in
migration **39**. No rest-day CTA; the ping is a nudge to train. Rest days
use `grind_is_rest_day` so a day that's already rest does not get the ping.

**Rest-end:** still primarily **page timers** while the PWA can run. The hourly
Hobby fan-out is only a locked-phone fallback (up to ~1 hour late — not useful
for a 90s rest; don’t rely on it for gym rest alerts).

On **Pro**, you can collapse this to one `*/15 * * * *` (or `* * * * *`) entry
instead of the 24 daily jobs.

## Client defaults (anti-spam)

- Rest-complete: **on**
- 10s warning: **off**
- Workout status card (background only): **on**
- Streak reminder: **on**
- No per-second ticking notifications
- When the PWA is focused: close `grind-*` tags and clear the app badge

## iOS

Web Push requires the app added to the Home Screen (standalone). Profile
Settings shows a hint when not installed.

## Notes

- **`dedupe_key` for rest** (must match cancel LIKE): `rest:<sessionId>:<exerciseId>:end|warn:<endsAtMs>`
- **`unique (endpoint)`** is intentional (one device endpoint → one user). Subscribe
  goes through `upsert_push_subscription` so account switch can transfer the row.
- **DST / streak hour:** spring-forward may skip the reminder hour; fall-back may
  hit twice — `unique(dedupe_key)` prevents double-send.
