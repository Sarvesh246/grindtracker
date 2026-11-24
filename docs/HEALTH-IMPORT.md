# Sleep and health import

GRIND supports one owner-configured Garmin Connect Personal connection. It syncs after Garmin receives the watch data and reuses the validated health ingestion pipeline. The file, Shortcut, and local script imports also use that pipeline.

## Garmin Connect Personal

Apply migration 82. In Vercel Production set `GARMIN_PERSONAL_OWNER_ID` to the intended GRIND account's Auth UUID, store `GARMIN_PERSONAL_API_KEY` as a sensitive server-only value, and set `GARMIN_PERSONAL_ENABLED=true`. The owner can check coverage and connect in **Settings → Sleep & health sources**. The cron driver from migration 82 reuses the existing Supabase Vault URL and cron credentials. The connector checks recent records every 30 minutes and runs smaller resumable backfill jobs for up to 90 days. It can be paused without losing previously imported history.

Review the first 14 days of morning outcomes before setting `GARMIN_PERSONAL_PUSH_PILOT_VERIFIED=true`. Turning it on exposes a separate push opt-in. Food logs, cycle or pregnancy records, and GPS routes each require their own opt-in and are removed when that opt-in is turned off. Garmin's chartable history depends on the device and the records returned for the account.

## Other import sources

| Route | Source id | Gives | Freshness | Where |
| --- | --- | --- | --- | --- |
| Garmin data export (zip, or `*_sleepData.json` + `*_healthStatusData.json`) | `garmin_export` | duration, stage totals, score, respiration, SpO2, naps; overnight HRV from the health-status file | manual | Settings → Sleep & health sources, parsed on the device |
| Apple Health via an iPhone Shortcut | `apple_health` | times, stage timeline, naps (never HRV) | automatic if the Shortcut is automated | `POST /api/watch/v1/health-import` with a device token |
| Garmin sync script (unofficial) | `garmin_unofficial` | timeline, score, respiration and SpO2 when available, plus overnight HRV from Garmin’s nightly HRV summary | whenever you run it (cron/launchd) | `public/tools/garmin-sleep-sync.py` → same endpoint |

## How the sources are combined

`mainSleep()` (`src/lib/health/model.ts`) shows one night per wake date:

1. Each source+device contributes only its latest revision.
2. The highest-ranked source wins: approved Garmin cloud > personal Garmin cloud >
   sync script > Garmin export > Apple Health > watch app.
3. Fields the winner lacks (stage timeline, score, HRV, respiration, SpO2) are
   filled from other sources whose interval overlaps by 70% or more. A different
   night or a nap never merges. `fields_from` records every borrowed field and the
   Sleep screens say so ("Garmin data export · stage timeline from Apple Health").
4. The winner's own values are never overwritten, and values are never averaged.

## Check Garmin sync before scheduling it

Run the downloaded script with `--days 7 --dry-run --require-hrv`. The first
run prompts for Garmin sign-in and saves the local session. Check the printed
HRV dates against Garmin Connect. The dry run needs no GRIND token and sends
nothing to GRIND. Then run with a GRIND URL and device token and omit
`--dry-run`. Scheduled jobs should use `--non-interactive --require-hrv` so a
missing session or missing HRV results in a failed job and a readable message.

## Safety and privacy decisions

- **The local script keeps its own session.** It logs in on the owner's
  computer (MFA prompt included) and keeps a refreshable session only in
  `~/.garmin-grind`. The Shortcut and script authenticate with a normal GRIND
  device token (shown once, stored hashed, revocable under Watch, rate limited).
- The unofficial route is against Garmin's terms and can break; it is documented as
  owner-only, and nothing in the server depends on it.
- Pausing health collection blocks every import (HTTP 409 `collection_paused`);
  deleting health data bumps the generation as before.
- Garmin's overnight HRV needs a Garmin source. For a file import, include both
  `sleepData.json` and `healthStatusData.json` from the same export. The
  owner-run script also fetches the dated HRV summary when it is missing from
  Garmin Connect's sleep response.
- Apple Health's HRV is SDNN, a different measure from Garmin's overnight HRV, so
  it is deliberately not imported. Untyped "Asleep" samples count toward duration
  but create no stages.
- Time zones: nothing is guessed. A whole-hour offset becomes an `Etc/GMT±N` zone;
  a named zone is used only if its calendar date for the wake time matches the
  source's own date; otherwise the next candidate, then UTC. DST and travel are
  covered by tests.
- Imports respect the existing 180-day history window and 14-nights-per-batch
  limit; older nights are skipped with a reason. Re-importing is idempotent
  (identity is `source:calendarDate:start`; later revisions win).

## What is verified and what is not

Verified in this repository: all three parsers against synthetic data in the
documented shapes, the zip filter, batching, the HTTP handler, and the whole path
(token → importer → real Postgres) including RLS, pause, revocation and replay.

**Verified against a real export (November 17, 2026):** 29 months of nights from a
real Garmin export parsed with no unexplained skips, and every wake date matched
Garmin's own `calendarDate`, including across DST changes. That run is what
added three things. SpO2 lives in `spo2SleepSummary.averageSPO2`. Naps come from
each day's `napList` and are imported as `kind: 'nap'`. Overnight HRV comes from
the separate `*_healthStatusData.json` file (the `HRV` metric for that calendar
day). The export also has empty days (`{ "retro": false }`) for nights the
watch wasn't worn; those are not reported as skipped. Comparing values with
Garmin Connect night by night is still up to the owner, using the preview.

**Not verified:** any Garmin Connect response, the
`garminconnect` library's behavior, and the iOS Shortcut steps on a device. The
Garmin shapes follow community documentation, are parsed defensively (unknown
fields become null; unusable nights are skipped with a reason), and the Settings
screen previews an export before saving so the first import can be compared with
Garmin Connect. If a real file differs, the parser is one function
(`parseGarminNight`) and the fix is a test plus a few lines.

## Shortcut troubleshooting

iOS Shortcuts sometimes drops custom request headers, which shows up as
`missing_token` even when a header is configured. The endpoint therefore also
accepts the device token as a `token` field in the JSON body (same TLS, same
revocation and rate limits; the body is never logged). Use the header when it works
and the body field when it does not.

### Error `setup_required`

The import endpoint answers `503 setup_required` when the database cannot find
`token_import_health_batch`: migration 64 is not applied, or PostgREST's schema
cache has not reloaded. Apply `docs/sql/64-health-import-sources.sql` and run
`notify pgrst, 'reload schema';`. Other database failures stay a generic
`service_unavailable` (the Vercel log shows the first 240 characters of the
database message, never the payload). The unit suite includes a simulated
Shortcut pull (two writers, `In Bed` rows, CRLF lines, minute-level fragments,
offset-less times) so the parser is exercised against realistic input.
