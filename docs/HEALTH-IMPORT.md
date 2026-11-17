# Sleep and health import (no Garmin API key)

Garmin's official cloud API needs partner approval, so GRIND takes sleep through
three owner-run routes. All three end in the same validated, revision-aware
ingestion (`health_ingest_batch`, migration 61) via migration 64, and the app
combines them per night.

| Route | Source id | Gives | Freshness | Where |
| --- | --- | --- | --- | --- |
| Garmin data export (zip or `*_sleepData.json`) | `garmin_export` | duration, stage totals, score, respiration | manual | Settings → Sleep & health sources, parsed on the device |
| Apple Health via an iPhone Shortcut | `apple_health` | times, stage timeline, naps (never HRV) | automatic if the Shortcut is automated | `POST /api/watch/v1/health-import` with a device token |
| Garmin sync script (unofficial) | `garmin_unofficial` | everything Garmin Connect shows: timeline, score, HRV, respiration, SpO2 | whenever you run it (cron/launchd) | `public/tools/garmin-sleep-sync.py` → same endpoint |

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

## Safety and privacy decisions

- **No Garmin credentials are stored by GRIND.** The script logs in on the owner's
  computer (MFA prompt included) and keeps a refreshable session only in
  `~/.garmin-grind`. The Shortcut and script authenticate with a normal GRIND
  device token (shown once, stored hashed, revocable under Watch, rate limited).
- The unofficial route is against Garmin's terms and can break; it is documented as
  owner-only, and nothing in the server depends on it.
- Pausing health collection blocks every import (HTTP 409 `collection_paused`);
  deleting health data bumps the generation as before.
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

**Not verified:** any real Garmin export or Garmin Connect response, the
`garminconnect` library's behavior, and the iOS Shortcut steps on a device. The
Garmin shapes follow community documentation, are parsed defensively (unknown
fields become null; unusable nights are skipped with a reason), and the Settings
screen previews an export before saving so the first import can be compared with
Garmin Connect. If a real file differs, the parser is one function
(`parseGarminNight`) and the fix is a test plus a few lines.
