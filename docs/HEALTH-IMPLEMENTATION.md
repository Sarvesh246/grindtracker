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
