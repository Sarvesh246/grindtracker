# CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request.

| Job | What it does |
| --- | --- |
| `check` | typecheck, unit tests (`npm test`), lint, `npm audit` (critical), production build with placeholder Supabase values |
| `sql-parity` | `npm run test:sql-parity` against a Postgres 16 service container |
| `e2e` | builds the app, starts a disposable Supabase stack and runs Playwright in Chromium and WebKit (`npm run test:e2e`) against `npm run start` |

## SQL ↔ TypeScript parity

The level curve, Sunday week start, and rest-day connectivity/budget exist in
Postgres and in `gamification.ts` / `restDays.ts` ("change one, change both").
`src/lib/utils/__tests__/sqlParity.test.ts` cuts the **latest definition** of
each function out of `docs/sql/*.sql`, loads it into a scratch Postgres with
minimal stand-in tables, and compares the results with the TypeScript for
boundary XP values, 70 dates, and 250 seeded random rest-day scenarios.

It is skipped (and says so) unless `PARITY_DATABASE_URL` or `PARITY_PSQL` is set,
so a plain `npm test` stays database-free. To run it locally you need a Postgres
you don't mind it creating `public.user_rest_*` tables in:

```bash
PARITY_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm run test:sql-parity
```

The same job runs `src/lib/watch/__tests__/watchApi.db.test.ts`, which loads a
Supabase stand-in (`scripts/__tests__/fixtures/supabase-stub.sql`: API roles,
`auth.uid()`, the dashboard-created base tables and policies) plus **every**
`docs/sql` migration into a `grind_watch_test` database next to the one the URL
names, then drives the watch API handlers against it. It keeps that database
between runs (migrations are idempotent; each run uses fresh user ids).

The parity comparison covers only the rules above. `grind_recompute_stats` (streak runs, XP, PRs)
needs the full Supabase schema and is not compared.

## End-to-end tests

CI boots a fresh local Supabase stack, loads the public base-schema fixture and
all tracked migrations in filename order, then verifies the migration ledger.
The SQL fixture supplies the dashboard-created tables and policies. The stack
supplies real Auth, PostgREST, Realtime and Storage. The signed-in workout suite
creates two fixture accounts, uses the production build in Chromium and WebKit,
and removes the fixture accounts when it finishes.

Locally, start a disposable Supabase stack using the same commands as the e2e
job. Set `GRIND_DB_E2E=1`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and `E2E_LOCAL_SERVICE_ROLE_KEY` from that
stack. The signed-in suite accepts only a loopback Supabase URL.

The Garmin release check uses the installed Connect IQ SDK and Forerunner
165 Music device definition. See [watch build instructions](../watch/README.md).

## Migration check

`npm run migrations:check` compares `docs/sql/*.sql` with `grind_migrations`
(see [SQL.md](SQL.md#tracking-what-has-been-applied)). It exits 1 and lists the
gaps, 2 if it cannot read the table.
