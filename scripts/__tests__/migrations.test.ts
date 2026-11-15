import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { SQL_DIR, listMigrationVersions, missingMigrations } from '../lib/migrations'

describe('migration tracking', () => {
  const versions = listMigrationVersions()

  it('finds the tracking migration and the numbered files', () => {
    assert.ok(versions.includes('00-migration-tracking'))
    assert.ok(versions.length > 50)
  })

  it('every migration file records itself in grind_migrations', () => {
    for (const v of versions) {
      const sql = readFileSync(path.join(SQL_DIR, `${v}.sql`), 'utf8')
      const insert = `insert into public.grind_migrations (version) values ('${v}')`
      assert.ok(sql.includes(insert), `${v}.sql must end with its grind_migrations insert`)
    }
  })

  it('missingMigrations reports only versions without a row', () => {
    assert.deepEqual(missingMigrations(['01-a', '02-b', '03-c'], ['01-a', '03-c']), ['02-b'])
    assert.deepEqual(missingMigrations(['01-a'], ['01-a', 'zz-extra']), [])
  })
})
