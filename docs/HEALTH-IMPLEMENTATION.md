# Health implementation and release evidence

This implements the web destination and the ingestion foundation from
[the research plan](HEALTH-RESEARCH-AND-PLAN.md). The complete health program
is **not yet complete**: live cloud import, the watch background service,
generated explanations and the 72-hour physical pilot remain gated.

## Available

- `/progress/health`, sleep detail, allowlisted metric detail, URL-backed date
  navigation, an accessible date sheet and 7/28/90-day trends.
- A Progress destination row in both exercise and no-exercise branches;
  Health return preserves the selected exercise, metric and scroll.
- Deterministic daily observations, supplied sleep stages or totals,
  separate day plots, recovery explanation, missing-data states and provenance.
- Resting HR, overnight HRV, activity and supported watch snapshot metrics.
  Snapshot sync time is never described as measurement time. The legacy
  daily buckets explicitly retain local-time/DST uncertainty.
- Refresh on focus/reconnect/date change/health mutations, account-change
  invalidation, editable Coach suggestions without automatically sending chat.
- Private export, pause/resume and deletion which also pauses collection.
- Account-wide deletion uses `/api/profile/delete-data` to remove the owner's
  private objects through the supported Storage API before its database RPC.
  Migration 62 prevents deleting database records while private files remain.
- Migration 61: owner RLS/grants, connection ownership, UTC samples, sleep
  revisions, atomic deduplication, revision ordering and generation checks.
- A bounded authenticated watch health-batch endpoint; `HEALTH_WATCH_BATCHES_ENABLED`
  defaults off. Old `/daily` and workout uploads remain compatible.

## Source gates

No Garmin credentials were available in the local configuration. The official
Personal API reference and example client were inspected; no response shape or
actual device capability is assumed from endpoint names. Personal keys must
only serve the owner's pilot, never other users. Public cloud connections need
approved business access and a verified adapter/consent flow.

There is deliberately no enabled cloud connector, periodic cloud poller,
encrypted credential store or fabricated background service. These need real
credentials, payload validation and device evidence. Canonical projections and
generated insights tables are foundations; no background job populates them
yet. The web continues reading `daily_body` compatibility snapshots and supplied
sleep records. New raw batches must stay disabled until projections, source
precedence and device queue behavior have been verified.

Coach's Health entry prepares an editable question with the selected date.
Importing sleep/HRV into server Coach context and generated explanations remain
separate follow-up work; this release does not claim that Coach reads imported
sleep. No hidden AI calls or separate summary quota are introduced.

## Verification

Synthetic fixtures live in `e2e/fixtures/health.tsx`. Run:

```powershell
npx playwright test --config=e2e/health.config.ts
npm test
npm run typecheck
npm run lint
npm run build
```

The UI suite covers 320/390/430/768/1280px in both themes, disconnected/partial/
delayed/error/loading states, sleep and metric details at 200% text size, date
navigation, keyboard interval selection, tables and the non-sending Coach entry.
Screenshots use the actual components, stylesheet and bundled font files.
They contain only synthetic measurements.

Database tests load **all** repository migrations into throwaway Postgres and
exercise replay/conflicts/zero values, source ownership, RLS, sleep revisions,
deletion and stale generation rejection. Windows Docker support:

```powershell
$env:PARITY_DOCKER_CONTAINER='grind-health-test'
$env:PARITY_DATABASE_URL='postgres://postgres:grind-local-test@127.0.0.1:5432/postgres'
$env:PARITY_PSQL='docker exec -i grind-health-test psql -U postgres -v ON_ERROR_STOP=1 -qAt -F ,'
npm run test:sql-parity
```

Physical iOS PWA/VoiceOver, unfamiliar-user usability, real Garmin sleep matching,
closed-watch sync and battery/runtime tests cannot be inferred from browser
emulation. Coach provider evaluation was attempted and hit upstream quota;
it is not a passing live evaluation.

Release checks on November 16, 2026: 518 unit tests, 23 real-Postgres checks,
31 browser tests, typecheck, lint and production builds passed. The exact
staged code was also checked in a detached worktree. A signed-in production
build was reviewed at all five widths in both themes using a disposable
synthetic account, including empty workout history, long exercise names,
Progress return state, an editable Coach draft, and deletion of a synthetic
private image plus account records. The test account was removed afterwards.
The dependency audit reports zero known vulnerabilities after updating Next.js,
its lint configuration, Sharp and affected transitive dependencies.

Production migrations 61/62 were applied and the migration/function check
passed. Ingestion and internal deletion helpers have no anon/authenticated
execute grants; owner controls explicitly check the caller. Existing project
advisor findings remain for a legacy [mutable search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable),
an [extension in the public schema](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public),
and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
This is not a claim of a complete application-wide security audit.

## Rollout and rollback

Apply `docs/sql/61-health-foundation.sql` and `62-account-storage-cleanup.sql`
before dependent code. Keep
`HEALTH_WATCH_BATCHES_ENABLED` unset. Nothing changes the watch binary or adds
cron jobs. Observe web read errors and new batch refusals without logging
health payloads or secrets. Disable the batch flag to stop versioned uploads;
pause collection to stop physiological ingestion while preserving workouts.
Set `NEXT_PUBLIC_HEALTH_PAGE_ENABLED=false` and rebuild to hide the destination
entry and stop Health page reads while keeping history and privacy controls.
Roll back web code without dropping historical tables. Do not rerun migration
59 alone over the health privacy wrappers; rerun 61 afterwards if repairing old
migrations.

## Program status by work item (updated November 17, 2026)

What is built and tested versus what still needs things only a real account,
a signed Garmin approval or physical devices can provide. Nothing below is
claimed beyond its evidence.

| # | Item | State |
| --- | --- | --- |
| 1 | Garmin cloud connector, credential storage, token refresh, catch-up/backfill, business consent flow | **Not built.** Needs Garmin partner approval and real credentials. The schema (`health_connections`, `sync_cursor`, generation checks) is ready; no connector, credential store or poller is shipped, deliberately, rather than guessing provider payloads or storing someone's Garmin password. |
| 2 | Import real sleep, HRV, respiration; confirm against Garmin Connect | **Partly.** Validation, revision-aware storage, naps, timezone/wake-date checks and DST-safe day assignment are implemented and tested (`reconcile.test.ts`, real-Postgres suite). Mapping real Garmin responses and matching Garmin Connect with the watch app closed needs a live connector and device. |
| 3 | Reconcile sources, canonical summaries, UTC samples in the UI, retention | **Mostly.** Source precedence (current over partial, approved cloud over personal over watch, later measurement, later revision; never averaged) lives in `src/lib/health/reconcile.ts`. The web now reads `health_samples` and overlays them on the legacy `daily_body` snapshot with per-value provenance. Migration 63 + `/api/cron/health-retention` (daily) add scheduled retention. `health_daily_summaries` is still not populated by a background job. |
| 4 | Connect IQ background service, durable upload queue | **Not built.** Needs the Connect IQ SDK, a watch and battery testing. The batch endpoint stays behind `HEALTH_WATCH_BATCHES_ENABLED` (off). |
| 5 | Recovery interpretation, unified baselines and coverage | **Partly.** `metricBaseline` now backs every "usual range" shown on Health (tiles, trends, band) and the Coach's HRV range. Charge's own 30-day resting-HR baseline and weights are unchanged and still unvalidated; unifying them would change users' scores and needs a decision plus real data. |
| 6 | Coach integration | **Partly.** The Coach's body block now carries imported sleep and overnight HRV with wake time, status, source, nights recorded and an HRV range, only when the user allowed body data (existing opt-out). Generated explanations, grounding checks, caching and a separate summary budget are not built, and the live `coach:eval` was not run (needs provider quota). |
| 7 | Interface details | **Partly.** Day timeline shows workout and sleep annotations; the status panel shows each connection's state, freshness and a per-measurement source table. Charts are read by dragging (mouse and touch tested in Chromium). Sleep-aware Progress summaries, pre-workout observations and iPhone PWA/VoiceOver validation are not done. |
| 8 | Validate and enable | **Not done.** Needs real provider failure drills, the 72-hour watch/iPhone pilot and gradual enablement. |

### Through-the-day data (November 17, 2026)

The watch app already reads the whole day's Body Battery and stress history from
Garmin's on-watch `SensorHistory` (about 24 hours at ~5-minute resolution) every
time it uploads, so each `daily_body` row carries a full 96-bucket curve. Health
now uses that: "Your day" draws your usual range for each time of day (25th–75th
percentile of the previous 14 days, only when 5+ days have a reading in that
bucket) behind today's curves, and the reading chip shows "usual a–b" for the
touched moment.

What it cannot fix: uploads still happen only when GRIND is opened on the watch,
so "today so far" is as fresh as your last open. Automatic hourly uploads need the
Connect IQ background service (work item 4), which can't be built or verified
without the Connect IQ SDK and a watch, so it is not shipped.

### Sleep import without an API key (November 17, 2026)

Work items 1–3 now have a working, key-free path for sleep: Garmin data export
upload, an Apple Health Shortcut and an owner-run Garmin sync script, combined
field by field per night. See [HEALTH-IMPORT.md](HEALTH-IMPORT.md) for the design,
precedence, privacy decisions and exactly what is and is not verified. The
official Garmin cloud connector (item 1), the Connect IQ background service
(item 4) and the device pilot (item 8) are still not built.

