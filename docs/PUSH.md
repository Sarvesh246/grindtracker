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

[`vercel.json`](../vercel.json) hits `/api/cron/notifications` once per day
(`0 1 * * *` UTC). **Hobby only allows daily crons** — expressions like
`*/15 * * * *` fail the deployment. The handler:

1. Calls `schedule_streak_reminders()` for users whose local hour matches
   their streak reminder hour (default 19:00).
2. Claims due `scheduled_notifications` via `claim_due_notifications()`.
3. Sends each via `web-push`. Auth: `Authorization: Bearer $CRON_SECRET`
   (Vercel injects this for its own crons).

**Rest-end latency:** 60–180s rests are delivered by **page timers** (and a
best-effort SW timer) while the PWA’s JS can still run. The Vercel daily cron
is only a weak locked-phone fallback.

### Recommended on Hobby: external 15‑minute ping

For evening streak reminders at the right local hour and a better locked-phone
rest fallback, point a free external cron (e.g. [cron-job.org](https://cron-job.org))
at:

`GET https://grindtrack.vercel.app/api/cron/notifications`

Header: `Authorization: Bearer <your CRON_SECRET>`  
Schedule: every 15 minutes.

On **Pro**, you can change `vercel.json` to `*/15 * * * *` (or `* * * * *`)
and skip the external cron.

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
