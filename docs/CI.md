# CI

`.github/workflows/ci.yml` runs on every push to `main` and every pull request.

| Job | What it does |
| --- | --- |
| `check` | typecheck, unit tests (`npm test`), lint, `npm audit` (critical), production build with placeholder Supabase values |
| `sql-parity` | `npm run test:sql-parity` against a Postgres 16 service container |
| `e2e` | installs Chromium and runs Playwright (`npm run test:e2e`) against `npm run dev` |

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

It covers only the rules above. `grind_recompute_stats` (streak runs, XP, PRs)
needs the full Supabase schema and is not compared.

## End-to-end tests

Today `e2e/` covers the **public shell** (login page, redirects, offline service
worker) and needs no real credentials, so the `e2e` job falls back to placeholder
Supabase values. There is **no signed-in workout flow test yet**; writing one
needs a test user and a throwaway Supabase project.

To point the job at a throwaway project, add these repository secrets:

| Secret | Used for |
| --- | --- |
| `E2E_SUPABASE_URL` | `NEXT_PUBLIC_SUPABASE_URL` for the build and dev server |
| `E2E_SUPABASE_ANON_KEY` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `E2E_SUPABASE_SERVICE_ROLE_KEY` | enables the `migrations:check` step, which fails the job if that project is missing any `docs/sql` migration |

The throwaway project must be built by hand from `docs/sql/`, like production;
the repo has no base-schema file to create it from scratch.
Never put the production service-role key in CI.

## Migration check

`npm run migrations:check` compares `docs/sql/*.sql` with `grind_migrations`
(see [SQL.md](SQL.md#tracking-what-has-been-applied)). It exits 1 and lists the
gaps, 2 if it cannot read the table.
