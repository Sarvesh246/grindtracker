/**
 * Compare docs/sql/*.sql against public.grind_migrations on a Supabase project.
 *
 *   npm run migrations:check                 # exit 1 if any file has no row
 *   npm run migrations:check -- --backfill   # print an INSERT for every file
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (the table is
 * RLS-locked, so the anon key cannot read it). Put them in .env.local, or in
 * the environment in CI. --backfill needs no credentials: run it once against
 * a project whose state you have verified by hand, paste the output in the
 * SQL editor, and the tracker starts out accurate.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SQL_DIR, expectedFunctions, listMigrationVersions, missingMigrations } from './lib/migrations'

async function main(): Promise<number> {
  const expected = listMigrationVersions()

  if (process.argv.includes('--backfill')) {
    console.log('insert into public.grind_migrations (version) values')
    console.log(expected.map(v => `  ('${v}')`).join(',\n'))
    console.log('on conflict (version) do nothing;')
    return 0
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.')
    return 2
  }

  const res = await fetch(`${url}/rest/v1/grind_migrations?select=version`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    const hint = res.status === 404 ? ' (has 00-migration-tracking.sql been applied?)' : ''
    console.error(`Could not read grind_migrations: HTTP ${res.status}${hint}`)
    return 2
  }
  const rows = (await res.json()) as { version: string }[]
  const missing = missingMigrations(expected, rows.map(r => r.version))

  if (missing.length > 0) {
    console.error(`${missing.length} of ${expected.length} migrations have no row:`)
    for (const v of missing) console.error(`  - ${v}`)
    return 1
  }
  console.log(`All ${expected.length} migrations recorded.`)

  // A row is not proof the SQL ran. PostgREST's schema lists every function
  // the service role can call, so a missing one means a recorded migration
  // never actually ran (or was later overwritten by an older file).
  const spec = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' },
  })
  if (!spec.ok) {
    console.error(`Could not read the API schema: HTTP ${spec.status}`)
    return 2
  }
  const paths = Object.keys(((await spec.json()) as { paths?: Record<string, unknown> }).paths ?? {})
  const live = new Set(paths.filter(p => p.startsWith('/rpc/')).map(p => p.slice('/rpc/'.length)))
  const files = expected.map(version => ({ version, sql: readFileSync(path.join(SQL_DIR, `${version}.sql`), 'utf8') }))
  const absent = [...expectedFunctions(files)].filter(([fn]) => !live.has(fn))
  if (absent.length === 0) {
    console.log('Every migration function exists.')
    return 0
  }
  console.error(`${absent.length} functions are missing. Re-run the file that defines each:`)
  for (const [fn, version] of absent) console.error(`  - ${fn}  (${version}.sql)`)
  return 1
}

// Set the exit code and let Node drain open handles; calling process.exit()
// while fetch's socket is closing trips a libuv assertion on Windows.
main().then(
  code => {
    process.exitCode = code
  },
  err => {
    console.error(err)
    process.exitCode = 2
  },
)
