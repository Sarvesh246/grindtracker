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

/**
 * Every callable function the migrations leave behind, mapped to the file that
 * last defines it. Trigger functions are skipped (PostgREST never lists them),
 * and so is anything a later file drops.
 *
 * A row in grind_migrations only proves someone inserted it: the 00 backfill
 * recorded 57 without its SQL ever running, which broke watch uploads. Checking
 * that the functions really exist catches that.
 */
export function expectedFunctions(files: { version: string; sql: string }[]): Map<string, string> {
  const out = new Map<string, string>()
  for (const { version, sql } of files) {
    const defs = sql.matchAll(
      /create\s+or\s+replace\s+function\s+(?:public\.)?([a-z_0-9]+)\s*\([^)]*\)\s*returns\s+([a-z_]+)/gi,
    )
    for (const [, name, returns] of defs) {
      if (returns.toLowerCase() === 'trigger') out.delete(name.toLowerCase())
      else out.set(name.toLowerCase(), version)
    }
    for (const [, name] of sql.matchAll(/drop\s+function\s+(?:if\s+exists\s+)?(?:public\.)?([a-z_0-9]+)/gi)) {
      out.delete(name.toLowerCase())
    }
  }
  return out
}

/** Versions in `expected` that have no row in `applied`. */
export function missingMigrations(expected: string[], applied: Iterable<string>): string[] {
  const have = new Set(applied)
  return expected.filter(v => !have.has(v))
}
