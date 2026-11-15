/**
 * SQL <-> TypeScript parity for the rules that live in both places
 * ("change one, change both" in CLAUDE.md): the level curve, the Sunday week
 * start, and rest-day connectivity / weekly budget.
 *
 * The SQL side is the real function text, cut out of docs/sql/*.sql and loaded
 * into a THROWAWAY Postgres (it creates public.user_rest_* tables) next to minimal stand-in tables - no Supabase, no
 * auth schema. It is skipped unless a database is supplied:
 *
 *   PARITY_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm run test:sql-parity
 *
 * (needs `psql` on PATH). To run psql some other way, e.g. inside Docker, set
 * PARITY_PSQL to a command that reads SQL on stdin and prints unaligned,
 * comma-separated rows, e.g. `docker exec -i pg psql -U postgres -v ON_ERROR_STOP=1 -qAt -F ,`.
 * CI runs it against a postgres service container.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getLevel } from '../gamification'
import { datesConnected, restBudgetForWeek, weekStart, type RestWeekdayInterval } from '../restDays'

const SQL_DIR = path.join(__dirname, '..', '..', '..', '..', 'docs', 'sql')

const dbUrl = process.env.PARITY_DATABASE_URL
const psqlCmd =
  process.env.PARITY_PSQL ?? (dbUrl ? `psql "${dbUrl}" -v ON_ERROR_STOP=1 -qAt -F ,` : undefined)

/**
 * The definition of `name(signature...)` from the LATEST top-level migration
 * that defines the function. Taking the newest file is the point: if someone
 * redefines a function in a later migration, this test follows it.
 */
function latestDefinition(name: string, signature: string): string {
  const files = readdirSync(SQL_DIR)
    .filter(f => /^\d{2}-.+\.sql$/.test(f))
    .sort()
  const sig = signature.replace(/[()]/g, '\\$&')
  const header = new RegExp(`create or replace function\\s+(public\\.)?${name}\\s*\\(${sig}`, 'i')
  for (const file of [...files].reverse()) {
    const src = readFileSync(path.join(SQL_DIR, file), 'utf8').replace(/\r\n/g, '\n')
    const start = header.exec(src)
    if (!start) continue
    const end = src.indexOf('\n$$;', start.index)
    assert.ok(end > 0, `unterminated ${name} in ${file}`)
    return src.slice(start.index, end + 4)
  }
  throw new Error(`no migration defines ${name}(${signature})`)
}

// Seeded PRNG so a failure reproduces.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

const key = (d: Date) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
const addDays = (k: string, n: number) => key(new Date(Date.parse(k + 'T00:00:00Z') + n * 86_400_000))

type Scenario = {
  id: number
  today: string
  from: string
  to: string
  intervals: RestWeekdayInterval[]
  oneOffs: string[]
  cancels: string[]
}

function buildScenarios(count: number): Scenario[] {
  const rand = rng(20260115)
  const pick = (n: number) => Math.floor(rand() * n)
  const base = '2026-03-01'
  return Array.from({ length: count }, (_, id) => {
    const today = addDays(base, pick(120))
    const intervals: RestWeekdayInterval[] = []
    for (let dow = 0; dow < 7; dow++) {
      if (rand() < 0.35) {
        // At most one OPEN interval per weekday (partial unique index in 43).
        const from = rand() < 0.5 ? '1970-01-01' : addDays(today, pick(21) - 14)
        intervals.push({ dayOfWeek: dow, effectiveFrom: from, effectiveUntil: null })
      } else if (rand() < 0.25) {
        const from = addDays(today, -pick(60) - 8)
        intervals.push({ dayOfWeek: dow, effectiveFrom: from, effectiveUntil: addDays(from, pick(30) + 1) })
      }
    }
    const around = (n: number) =>
      Array.from(new Set(Array.from({ length: n }, () => addDays(today, pick(40) - 20))))
    const from = addDays(today, -pick(14))
    return { id, today, from, to: addDays(from, pick(10)), intervals, oneOffs: around(pick(4)), cancels: around(pick(3)) }
  })
}

const q = (v: string) => `'${v}'`
const USER = "'00000000-0000-0000-0000-000000000001'"

// The extracted functions pin `search_path = public` and name public.user_rest_*,
// so the stand-in tables live in public. Point this at a THROWAWAY database.
const HARNESS = [
  'drop table if exists public.user_rest_days, public.user_rest_dates, public.user_rest_cancels;',
  'create schema if not exists auth;',
  'create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;',
  'create table public.user_rest_days (user_id uuid, day_of_week int, effective_from date, effective_until date);',
  'create table public.user_rest_dates (user_id uuid, rest_date date);',
  'create table public.user_rest_cancels (user_id uuid, rest_date date);',
].join('\n')

describe('SQL <-> TS parity', { skip: psqlCmd ? false : 'set PARITY_DATABASE_URL (or PARITY_PSQL) to run' }, () => {
  const scenarios = buildScenarios(250)
  const xps = [-50, 0, 1, 499, 500, 501, 1499, 1500, 1501, 2999, 3000, 3001, 5000, 9999, 10_000, 123_456]
  for (let n = 1; n <= 40; n++) {
    const t = (500 * n * (n - 1)) / 2
    xps.push(t - 1, t, t + 1)
  }
  const weekDates = Array.from({ length: 70 }, (_, i) => addDays('2026-01-01', i * 3))

  const lines: string[] = [
    HARNESS,
    latestDefinition('grind_level_for_xp', 'p_xp numeric'),
    latestDefinition('grind_week_start', 'p_date date'),
    latestDefinition('grind_is_rest_day', 'p_user uuid, p_date date'),
    latestDefinition('grind_dates_connected', 'p_user uuid, p_from date, p_to date'),
    latestDefinition('grind_rest_budget', 'p_user uuid, p_as_of date'),
  ]
  for (const xp of xps) lines.push(`select 'L', ${xp}, grind_level_for_xp(${xp});`)
  for (const d of weekDates) lines.push(`select 'W', ${q(d)}, grind_week_start(${q(d)}::date);`)
  for (const s of scenarios) {
    for (const i of s.intervals) {
      const until = i.effectiveUntil ? q(i.effectiveUntil) : 'null'
      lines.push(`insert into public.user_rest_days values (${USER}, ${i.dayOfWeek}, ${q(i.effectiveFrom)}, ${until});`)
    }
    for (const d of s.oneOffs) lines.push(`insert into public.user_rest_dates values (${USER}, ${q(d)});`)
    for (const d of s.cancels) lines.push(`insert into public.user_rest_cancels values (${USER}, ${q(d)});`)
    lines.push(
      `select 'C', ${s.id}, grind_dates_connected(${USER}, ${q(s.from)}, ${q(s.to)}), grind_rest_budget(${USER}, ${q(s.today)});`,
    )
    lines.push('truncate public.user_rest_days, public.user_rest_dates, public.user_rest_cancels;')
  }

  const out = new Map<string, string[]>()
  if (psqlCmd) {
    const raw = execSync(psqlCmd, { input: lines.join('\n'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    for (const line of raw.split(/\r?\n/).filter(Boolean)) {
      const [tag, id, ...rest] = line.split(',')
      out.set(`${tag}:${id}`, rest)
    }
  }

  it('grind_level_for_xp matches getLevel', () => {
    for (const xp of xps) {
      assert.equal(Number(out.get(`L:${xp}`)?.[0]), getLevel(xp), `xp=${xp}`)
    }
  })

  it('grind_week_start matches weekStart (Sunday)', () => {
    for (const d of weekDates) {
      assert.equal(out.get(`W:${d}`)?.[0], weekStart(d), `date=${d}`)
    }
  })

  it('grind_dates_connected matches datesConnected', () => {
    for (const s of scenarios) {
      const sql = out.get(`C:${s.id}`)?.[0] === 't'
      const ts = datesConnected(s.from, s.to, new Set(), new Set(s.oneOffs), {
        intervals: s.intervals,
        cancels: new Set(s.cancels),
      })
      assert.equal(sql, ts, `scenario ${s.id}: ${JSON.stringify(s)}`)
    }
  })

  it('grind_rest_budget matches restBudgetForWeek', () => {
    for (const s of scenarios) {
      const sql = Number(out.get(`C:${s.id}`)?.[1])
      const ts = restBudgetForWeek(s.today, new Set(), { intervals: s.intervals })
      assert.equal(sql, ts, `scenario ${s.id}: ${JSON.stringify(s)}`)
    }
  })

  it('exercises both outcomes so the comparison is not vacuous', () => {
    const results = scenarios.map(s => out.get(`C:${s.id}`)?.[0])
    assert.ok(results.includes('t') && results.includes('f'))
  })
})
