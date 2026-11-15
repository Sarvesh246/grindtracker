import { readdirSync } from 'node:fs'
import path from 'node:path'

export const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')

/** Top-level migration files only; the 10-parts/ and 11-parts/ folders are
 *  split-paste fallbacks of the main file, not separate migrations. */
export function listMigrationVersions(dir: string = SQL_DIR): string[] {
  return readdirSync(dir)
    .filter(name => /^\d{2}-.+\.sql$/.test(name))
    .map(name => name.slice(0, -'.sql'.length))
    .sort()
}

/** Versions in `expected` that have no row in `applied`. */
export function missingMigrations(expected: string[], applied: Iterable<string>): string[] {
  const have = new Set(applied)
  return expected.filter(v => !have.has(v))
}
