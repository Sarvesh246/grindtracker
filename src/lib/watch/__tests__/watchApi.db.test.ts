/**
 * Watch API against the REAL migrations: loads a Supabase stand-in
 * (scripts/__tests__/fixtures/supabase-stub.sql) plus every docs/sql file into
 * a scratch database, then drives the production handlers with `rpc` routed
 * through psql as the service_role. Covers what a fake can't: token hashing
 * parity, idempotency, partial sync → completion, stats, grants, RLS, and that
 * watch rows show up in the same history reads the web app uses.
 *
 * Skipped unless PARITY_DATABASE_URL is set (the Postgres CI's sql-parity job
 * provides). It creates a database named `grind_watch_test` next to the one
 * the URL names (on first run) and keeps it: migrations are idempotent and each
 * run uses fresh random user ids, so runs never see each other's rows.
 *
 *   PARITY_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm run test:sql-parity
 */
import { before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { healthImportRequest } from '@/lib/health/importApi'
import { watchPing, watchRepLab, watchTelemetry, watchReadiness, watchSessions, watchToday, type WatchDeps, type RpcResult } from '../handlers'

const ROOT = path.join(__dirname, '..', '..', '..', '..')
const SQL_DIR = path.join(ROOT, 'docs', 'sql')
const STUB = path.join(ROOT, 'scripts', '__tests__', 'fixtures', 'supabase-stub.sql')
const baseUrl = process.env.PARITY_DATABASE_URL

const DB_NAME = 'grind_watch_test'
const dbUrl = (() => {
  if (!baseUrl) return ''
  const u = new URL(baseUrl)
  u.pathname = `/${DB_NAME}`
  return u.toString()
})()

function psql(url: string, sql: string): string {
  const container = process.env.PARITY_DOCKER_CONTAINER
  return execFileSync(container ? 'docker' : 'psql', [...(container ? ['exec', '-i', container, 'psql'] : []), url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-X'], {
    input: sql,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim()
}
const db = (sql: string) => psql(dbUrl, sql)

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

/** Call a function the way PostgREST would for the service-role key. */
async function serviceRpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
  const call = `${fn}(${Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')})`
  try {
    const out = db(`set role service_role; select to_json(${call})::text;`)
    return { data: out ? JSON.parse(out) : null, error: null }
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? err)
    return { data: null, error: { message: stderr.replace(/^[\s\S]*ERROR:\s*/, '').trim() } }
  }
}

/** Run SQL as a signed-in web user (RLS applies), like the browser client. */
function asUser(userId: string, sql: string): string {
  return db(`set role authenticated; select set_config('request.jwt.claim.sub', '${userId}', false); ${sql}`)
    .split('\n')
    .slice(1)
    .join('\n')
}

let clock = new Date()
const completions: unknown[] = []
const deps: WatchDeps = {
  rpc: serviceRpc,
  afterCompletion: async info => {
    completions.push(info)
  },
  now: () => clock,
  log: () => {},
}

function request(pathname: string, token: string | null, body?: unknown) {
  return new Request(`https://grind.test/api/watch/v1${pathname}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

// Fresh ids every run (the database is reused between runs).
const ids = new Map<string, string>()
const id = (name: string) => {
  if (!ids.has(name)) ids.set(name, randomUUID())
  return ids.get(name)!
}
const ALICE = id('alice')
const BOB = id('bob')

let aliceToken = ''
let bobToken = ''

const iso = (minutesAgo: number) => new Date(clock.getTime() - minutesAgo * 60_000).toISOString()
const codeOf = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code

describe('watch API against the real schema', { skip: !baseUrl && 'set PARITY_DATABASE_URL to run' }, () => {
  describe('health foundation isolation and ingestion', () => {
    const healthUser = randomUUID(), healthDevice = randomUUID(), connection = randomUUID()
    const batchId = randomUUID()
    let payload: Record<string, unknown>
    before(() => {
      db(`insert into auth.users(id,email) values('${healthUser}','health-test@test'); insert into public.watch_devices(id,user_id,name,token_hash,token_hint) values('${healthDevice}','${healthUser}','Health fixture','${randomUUID().replaceAll('-', '').repeat(2)}','test');`)
      const at = new Date(Date.now() - 60_000).toISOString()
      payload = { version: 1, batch_id: batchId, generation: 0, source: 'connect_iq', captured_at: at, samples: [{ provider_id: 'steps', metric: 'steps', start_at: at, end_at: at, observed_at: at, revision_at: at, value: 0, unit: 'steps', kind: 'total', quality: 'partial' }], sleeps: [] }
    })
    it('deduplicates replay, preserves zero and rejects conflicting batch identities', async () => {
      const args = { p_user: healthUser, p_device: healthDevice, p_batch: payload }
      const first = await serviceRpc('watch_ingest_health_batch', args)
      assert.equal(first.error, null)
      assert.equal((first.data as { duplicate: boolean }).duplicate, false)
      const replay = await serviceRpc('watch_ingest_health_batch', args)
      assert.equal((replay.data as { duplicate: boolean }).duplicate, true)
      assert.equal(db(`select count(*) from health_samples where user_id='${healthUser}' and value=0`), '1')
      const conflict = await serviceRpc('watch_ingest_health_batch', { ...args, p_batch: { ...payload, captured_at: new Date().toISOString() } })
      assert.match(conflict.error?.message ?? '', /HEALTH_BATCH_CONFLICT/)
    })
    it('never allows client writes, cross-owner reads, or service connection substitution', async () => {
      assert.equal(asUser(healthUser, `select count(*) from health_samples where user_id='${healthUser}'`), '1')
      assert.equal(asUser(BOB, `select count(*) from health_samples where user_id='${healthUser}'`), '0')
      assert.throws(() => asUser(healthUser, `delete from health_samples where user_id='${healthUser}'`), /permission denied/)
      assert.throws(() => asUser(healthUser, `select health_ingest_batch('${healthUser}','${connection}','{}')`), /permission denied/)
      const wrong = await serviceRpc('watch_ingest_health_batch', { p_user: BOB, p_device: healthDevice, p_batch: payload })
      assert.match(wrong.error?.message ?? '', /HEALTH_DEVICE_UNAVAILABLE/)
    })
    it('stores cloud sleep revisions by provider identity and ignores older revisions', async () => {
      db(`insert into health_connections(id,user_id,source,device_id) values('${connection}','${healthUser}','garmin_personal','fixture');`)
      const end = new Date(Date.now() - 60_000), start = new Date(end.getTime() - 8 * 3600000)
      const night = { provider_id: 'night', wake_date: end.toISOString().slice(0,10), provider_date: end.toISOString().slice(0,10), timezone: 'UTC', start_at: start.toISOString(), end_at: end.toISOString(), kind: 'main', duration_seconds: 27000, score: null, stages: null, stage_totals: null, overnight_hrv: 45, respiration: null, spo2: null, revision_at: end.toISOString(), status: 'unknown' }
      const ingest = (record: unknown) => serviceRpc('health_ingest_batch', { p_user: healthUser, p_connection: connection, p_batch: { ...payload, source: 'garmin_personal', batch_id: randomUUID(), samples: [], sleeps: [record] } })
      assert.equal((await ingest(night)).error, null)
      assert.equal((await ingest({ ...night, duration_seconds: 28000, revision_at: new Date().toISOString() })).error, null)
      assert.equal((await ingest(night)).error, null)
      assert.equal(db(`select duration_seconds from sleep_sessions where connection_id='${connection}'`), '28000')
      assert.equal(asUser(BOB, `select count(*) from sleep_sessions where connection_id='${connection}'`), '0')
    })
    it('scheduled retention trims only expired raw rows and is service-role only', async () => {
      const old = new Date(Date.now() - 200 * 86400000).toISOString()
      const fresh = new Date(Date.now() - 60_000).toISOString()
      const sample = (id: string, at: string) => `insert into health_samples(user_id,connection_id,provider_id,metric,start_at,end_at,observed_at,revision_at,value,unit,kind,quality) values('${healthUser}','${connection}','${id}','steps','${at}','${at}','${at}','${at}',5,'steps','total','current');`
      db(sample('retention-old', old) + sample('retention-fresh', fresh))
      assert.throws(() => asUser(healthUser, 'select health_retention_cleanup();'), /permission denied/)
      const run = await serviceRpc('health_retention_cleanup', {})
      assert.equal(run.error, null)
      assert.ok((run.data as { samples: number }).samples >= 1)
      assert.equal(db(`select count(*) from health_samples where user_id='${healthUser}' and provider_id='retention-old'`), '0')
      assert.equal(db(`select count(*) from health_samples where user_id='${healthUser}' and provider_id='retention-fresh'`), '1')
      assert.equal(db(`select count(*) from sleep_sessions where user_id='${healthUser}'`), '1')
    })
    it('imports sleep from export/Apple Health sources, idempotently, as the signed-in owner or a device token', async () => {
      const end = new Date(Date.now() - 3600_000), start = new Date(end.getTime() - 7 * 3600000)
      const wake = end.toISOString().slice(0, 10)
      const night = (id: string) => ({ provider_id: id, wake_date: wake, provider_date: wake, timezone: 'UTC', start_at: start.toISOString(), end_at: end.toISOString(), kind: 'main', duration_seconds: 24000, score: 77, stages: null, stage_totals: { deep: 3600, light: 14400, rem: 6000 }, overnight_hrv: null, respiration: 14, spo2: null, revision_at: new Date().toISOString(), status: 'final' })
      const batch = (sleeps: unknown[]) => ({ version: 1, batch_id: randomUUID(), generation: 999, source: 'ignored', captured_at: new Date().toISOString(), samples: [], sleeps })
      const asOwner = (source: string, b: unknown) => asUser(healthUser, `select import_health_batch('${source}', ${lit(b)});`)
      assert.match(asOwner('garmin_export', batch([night('garmin_export:a')])), /acknowledged/)
      assert.match(asOwner('garmin_export', batch([night('garmin_export:a')])), /acknowledged/) // replay is harmless
      assert.equal(db(`select count(*) from sleep_sessions where user_id='${healthUser}' and provider_id='garmin_export:a' and source='garmin_export'`), '1')
      assert.throws(() => asOwner('garmin_personal', batch([night('x')])), /HEALTH_IMPORT_SOURCE/)
      assert.throws(() => asOwner('apple_health', { ...batch([]), samples: [{ metric: 'steps' }] }), /HEALTH_IMPORT_SAMPLES/)
      const viaToken = await serviceRpc('token_import_health_batch', { p_user: healthUser, p_device: healthDevice, p_source: 'apple_health', p_batch: batch([night('apple_health:b')]) })
      assert.equal(viaToken.error, null)
      assert.equal(db(`select count(*) from sleep_sessions where user_id='${healthUser}' and source in ('garmin_export','apple_health')`), '2')
      const wrongDevice = await serviceRpc('token_import_health_batch', { p_user: BOB, p_device: healthDevice, p_source: 'apple_health', p_batch: batch([]) })
      assert.match(wrongDevice.error?.message ?? '', /HEALTH_DEVICE_UNAVAILABLE/)
      assert.throws(() => asUser(BOB, `select health_import_batch('${healthUser}','apple_health','{}');`), /permission denied/)
      assert.equal(asUser(BOB, `select count(*) from sleep_sessions where user_id='${healthUser}'`), '0')
    })
    it('deletion pauses ingestion and rejects stale generations after explicit resume', async () => {
      asUser(healthUser, 'select delete_body_data();')
      assert.equal(db(`select count(*) from health_samples where user_id='${healthUser}'`), '0')
      assert.equal(db(`select count(*) from sleep_sessions where user_id='${healthUser}'`), '0')
      assert.equal(asUser(healthUser, 'select enabled from health_collection'), 'f')
      const stale = await serviceRpc('watch_ingest_health_batch', { p_user: healthUser, p_device: healthDevice, p_batch: { ...payload, batch_id: randomUUID() } })
      assert.ok(stale.error)
      db(`insert into daily_body(user_id,local_date,steps) values('${healthUser}',current_date,12);`)
      assert.equal(db(`select count(*) from daily_body where user_id='${healthUser}'`), '0')
      asUser(healthUser, 'select set_health_collection(true);')
      const delayed = await serviceRpc('watch_ingest_health_batch', { p_user: healthUser, p_device: healthDevice, p_batch: { ...payload, batch_id: randomUUID() } })
      assert.match(delayed.error?.message ?? '', /HEALTH_COLLECTION_CHANGED/)
    })
    it('requires Storage API cleanup before account deletion and leaves other owners alone', () => {
      db(`insert into storage.objects(bucket_id,name) values('progress-photos','${healthUser}/fixture.jpg');`)
      assert.throws(() => asUser(healthUser, 'select delete_my_grind_data();'), /STORAGE_CLEANUP_REQUIRED/)
      db(`delete from storage.objects where name='${healthUser}/fixture.jpg';`)
      asUser(healthUser, 'select delete_my_grind_data();')
      assert.equal(db(`select count(*) from health_connections where user_id='${healthUser}'`), '0')
      assert.equal(db(`select count(*) from user_profiles where id='${BOB}'`), '1')
    })
  })
  before(() => {
    if (psql(baseUrl!, `select 1 from pg_database where datname = '${DB_NAME}'`) !== '1') {
      psql(baseUrl!, `create database ${DB_NAME};`)
    }
    db(readFileSync(STUB, 'utf8'))
    // The stock Postgres parity service has no Supabase scheduler. Keep the
    // migration's schema, job-registration SQL and ledger in the test.
    const emulateCron = db("select count(*) from pg_available_extensions where name = 'pg_cron'") === '0'
    if (emulateCron) {
      db(readFileSync(path.join(path.dirname(STUB), 'cron-stub.sql'), 'utf8'))
    }
    for (const file of readdirSync(SQL_DIR).filter(f => /^\d{2}-.+\.sql$/.test(f)).sort()) {
      let sql = readFileSync(path.join(SQL_DIR, file), 'utf8')
      if (emulateCron && file === '65-energy-schedule.sql') {
        sql = sql.replace(/^create extension if not exists (?:pg_cron|pg_net with schema extensions);\r?$/gm, '')
      }
      db(sql)
    }
    db(`
      insert into auth.users (id, email) values ('${ALICE}', 'alice@test'), ('${BOB}', 'bob@test');
      insert into user_profiles (id, username, display_name) values
        ('${ALICE}', 'alice_${ALICE.slice(0, 8)}', 'Alice'), ('${BOB}', 'bob_${BOB.slice(0, 8)}', 'Bob');
      insert into user_stats (user_id) values ('${ALICE}'), ('${BOB}') on conflict (user_id) do nothing;
      insert into exercises (id, user_id, name, day_type, sets_target, reps_target, sort_order, weight_target, rest_seconds) values
        ('${id('bench')}', '${ALICE}', 'Bench Press', 'push', 3, '8-12', 0, 135, 120),
        ('${id('ohp')}', '${ALICE}', 'Overhead Press', 'push', 3, '6', 1, null, null),
        ('${id('row')}', '${ALICE}', 'Barbell Row', 'pull', 3, '8', 0, null, null),
        ('${id('squat')}', '${BOB}', 'Squat', 'legs', 5, '5', 0, null, null);
    `)
    const mint = (user: string, name: string) =>
      JSON.parse(asUser(user, `select create_watch_device('${name}')::text;`)).token as string
    aliceToken = mint(ALICE, 'Fenix 7')
    bobToken = mint(BOB, 'Forerunner')
  })

  describe('health import end to end (token → importer → real schema)', () => {
    const body = (tz = 'America/Chicago') => ({
      kind: 'apple_health',
      timezone: tz,
      samples: [
        { start: iso(60 * 9), end: iso(60 * 5), value: 'Core' },
        { start: iso(60 * 5), end: iso(60 * 2), value: 'REM' }
      ]
    })
    const send = (token: string, b: unknown) => healthImportRequest(request('/health-import', token, b), deps)
    it('saves a night, replays harmlessly, and keeps each user’s data separate', async () => {
      const first = await send(aliceToken, body())
      assert.equal(first.status, 200)
      assert.equal(((await first.json()) as { imported: number }).imported, 1)
      assert.equal((await send(aliceToken, body())).status, 200)
      assert.equal(db(`select count(*) from sleep_sessions where user_id='${ALICE}' and source='apple_health'`), '1')
      assert.equal(db(`select count(*) from sleep_sessions where user_id='${BOB}'`), '0')
      assert.equal(asUser(BOB, `select count(*) from sleep_sessions where user_id='${ALICE}'`), '0')
      assert.equal(db(`select count(*) from health_connections where user_id='${ALICE}' and source='apple_health'`), '1')
    })
    it('saves a night sent exactly as the Shortcut builds it: token in the body, samples as text lines', async () => {
      const lines = [
        `${iso(60 * 9)} | ${iso(60 * 5)} | Asleep (Core)`,
        `${iso(60 * 5)} | ${iso(60 * 4)} | Asleep (Deep)`,
        `${iso(60 * 4)} | ${iso(60 * 2)} | Asleep (REM)`,
        `${iso(60 * 10)} | ${iso(60 * 2)} | In Bed`
      ].join('\n')
      const res = await healthImportRequest(
        new Request('https://grind.test/api/watch/v1/health-import', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'apple_health', timezone: 'America/Chicago', token: aliceToken, samples: lines })
        }),
        deps
      )
      assert.equal(res.status, 200)
      assert.equal(((await res.json()) as { imported: number }).imported, 1)
      assert.equal(db(`select count(*) from sleep_sessions where user_id='${ALICE}' and source='apple_health' and stages is not null`), '1')
    })
    it('refuses to import while collection is paused', async () => {
      asUser(ALICE, 'select set_health_collection(false);')
      assert.equal(await codeOf(await send(aliceToken, body('UTC'))), 'collection_paused')
      asUser(ALICE, 'select set_health_collection(true);')
    })
    it('stops working the moment the device is revoked', async () => {
      const minted = JSON.parse(asUser(ALICE, `select create_watch_device('Shortcut to revoke')::text;`)) as { id: string; token: string }
      assert.equal((await send(minted.token, body())).status, 200)
      asUser(ALICE, `select revoke_watch_device('${minted.id}');`)
      assert.equal((await send(minted.token, body())).status, 401)
      db(`delete from watch_devices where id='${minted.id}'`) // keep later device-count checks exact
    })
  })

  describe('tokens and auth', () => {
    it('stores only the hash, which matches the API side', async () => {
      assert.match(aliceToken, /^gwt_[0-9a-f]{64}$/)
      assert.equal(db(`select count(*) from watch_devices where token_hash = '${aliceToken}'`), '0')
      const res = await watchPing(request('/ping', aliceToken), deps)
      assert.equal(res.status, 200)
      const body = (await res.json()) as { device: string; server_time: string }
      assert.equal(body.device, 'Fenix 7')
      assert.ok(!Number.isNaN(Date.parse(body.server_time)))
      assert.equal(db(`select last_used_at is not null from watch_devices where user_id = '${ALICE}' and name = 'Fenix 7'`), 't')
    })

    it('rejects a missing, unknown or revoked token with 401', async () => {
      assert.equal((await watchPing(request('/ping', null), deps)).status, 401)
      const unknown = await watchPing(request('/ping', 'gwt_' + '0'.repeat(64)), deps)
      assert.equal(unknown.status, 401)
      assert.equal(await codeOf(unknown), 'invalid_token')

      const spare = JSON.parse(asUser(ALICE, `select create_watch_device('Spare')::text;`)) as { id: string; token: string }
      assert.equal((await watchPing(request('/ping', spare.token), deps)).status, 200)
      // Bob can't revoke Alice's device; Alice can.
      assert.equal(asUser(BOB, `select revoke_watch_device('${spare.id}');`), 'f')
      assert.equal(asUser(ALICE, `select revoke_watch_device('${spare.id}');`), 't')
      const revoked = await watchPing(request('/ping', spare.token), deps)
      assert.equal(revoked.status, 401)
      assert.equal(await codeOf(revoked), 'token_revoked')
    })

    it('rate limits per device', async () => {
      const burst = JSON.parse(asUser(ALICE, `select create_watch_device('Burst')::text;`)) as { id: string; token: string }
      db(`update watch_devices set rl_count = 60, rl_window_start = now() where id = '${burst.id}'`)
      const res = await watchPing(request('/ping', burst.token), deps)
      assert.equal(res.status, 429)
      assert.ok(Number(res.headers.get('retry-after')) >= 1)
      assert.equal((await watchPing(request('/ping', aliceToken), deps)).status, 200, 'other devices unaffected')
      asUser(ALICE, `select revoke_watch_device('${burst.id}');`)
    })

    it('the watch RPCs are not callable by clients, and the hash is not readable', () => {
      for (const role of ['anon', 'authenticated']) {
        assert.throws(
          () => db(`set role ${role}; select watch_sync_session('${ALICE}', '{}'::jsonb);`),
          /permission denied/,
        )
        assert.throws(() => db(`set role ${role}; select watch_authenticate('x');`), /permission denied/)
        assert.throws(() => db(`set role ${role}; select watch_today_context('${ALICE}');`), /permission denied/)
      }
      assert.throws(() => asUser(ALICE, `select token_hash from watch_devices;`), /permission denied/)
      assert.equal(asUser(ALICE, `select count(*) from watch_devices;`), '3', 'own devices only')
      assert.equal(asUser(BOB, `select count(*) from watch_devices;`), '1', 'own devices only')
    })
  })

  describe('GET /today', () => {
    it("returns the rotation's up-next day with targets", async () => {
      const res = await watchToday(request('/today?unit=lbs', aliceToken), deps)
      assert.equal(res.status, 200)
      const body = (await res.json()) as { workout: { id: string; exercises: { id: string }[] } }
      assert.equal(body.workout.id, 'pull', 'auto rotation, no history: alphabetical first')
      assert.deepEqual(body.workout.exercises.map(e => e.id), [id('row')])
    })

    it('returns workout:null on a rest day', async () => {
      const today = new Date().toISOString().slice(0, 10)
      const before = (await (await watchToday(request(`/today?date=${today}`, bobToken), deps)).json()) as { workout: { id: string } }
      assert.equal(before.workout.id, 'legs')
      // A weekly rest day on today's weekday, in effect since long ago (a
      // bounded interval, so the insert guard keeps effective_from as given).
      db(`insert into user_rest_days (user_id, day_of_week, effective_from, effective_until)
          values ('${BOB}', extract(dow from '${today}'::date)::int, '1970-01-01', '2999-01-01')`)
      const res = await watchToday(request(`/today?date=${today}`, bobToken), deps)
      assert.equal(res.status, 200)
      const payload = await res.json()
      assert.deepEqual({ date: payload.date, unit: payload.unit, workout: payload.workout, reason: payload.reason }, { date: today, unit: 'lbs', workout: null, reason: 'rest_day' })
      assert.ok(Array.isArray(payload.days), 'available days remain in the rest-day response')
      db(`delete from user_rest_days where user_id = '${BOB}'`)
    })
  })

  describe('POST /sessions', () => {
    const S1 = id('s1')
    const set = (name: string, exercise: string, setNumber: number, weight: number, minutesAgo: number, extra: object = {}) => ({
      id: id(name),
      exercise_id: exercise,
      set_number: setNumber,
      reps: 8,
      weight,
      unit: 'lbs',
      completed_at: iso(minutesAgo),
      rest_seconds: 90,
      ...extra,
    })

    it('partial sync creates an open session (201), re-upload is a no-op (200)', async () => {
      clock = new Date()
      const body = { id: S1, workout_id: 'push', started_at: iso(60), utc_offset_seconds: 0, sets: [set('set1', id('bench'), 1, 135, 55)] }

      const first = await watchSessions(request('/sessions', aliceToken, body), deps)
      assert.equal(first.status, 201)
      const r1 = (await first.json()) as { session: { status: string }; sets: { accepted: string[] } }
      assert.equal(r1.session.status, 'open')
      assert.deepEqual(r1.sets.accepted, [id('set1')])

      for (let i = 0; i < 2; i++) {
        const again = await watchSessions(request('/sessions', aliceToken, body), deps)
        assert.equal(again.status, 200)
        const r = (await again.json()) as { sets: { accepted: string[]; duplicate: string[] } }
        assert.deepEqual(r.sets.accepted, [])
        assert.deepEqual(r.sets.duplicate, [id('set1')])
      }
      assert.equal(db(`select count(*) from sessions where id = '${S1}'`), '1')
      assert.equal(db(`select count(*) from session_logs where session_id = '${S1}'`), '1')
      assert.equal(db(`select source || ',' || (completed_at is null) from sessions where id = '${S1}'`), 'watch,true')
      assert.equal(db(`select xp_total from user_stats where user_id = '${ALICE}'`), '0', 'open sessions earn nothing yet')
    })

    it('later sets, an edited set, then completion — stats recompute once complete', async () => {
      const sets = [
        set('set1', id('bench'), 1, 140, 55),
        set('set2', id('bench'), 2, 0, 50, { unit: 'kg', weight: 61.2 }),
        set('set3', id('ohp'), 1, 95, 45, { is_warmup: true }),
      ]
      const res = await watchSessions(request('/sessions', aliceToken, {
        id: S1, workout_id: 'push', started_at: iso(60), utc_offset_seconds: 0, sets,
      }), deps)
      assert.equal(res.status, 200)
      const r = (await res.json()) as { session: { status: string }; sets: Record<string, unknown[]> }
      assert.equal(r.session.status, 'open')
      assert.deepEqual(r.sets.updated, [id('set1')])
      assert.deepEqual(r.sets.accepted, [id('set2'), id('set3')])
      assert.equal(
        db(`select weight || ',' || entered_weight || ',' || entered_unit || ',' || source from session_logs where id = '${id('set2')}'`),
        '134.9227,61.2,kg,watch',
      )

      const finish = await watchSessions(request('/sessions', aliceToken, {
        id: S1, workout_id: 'push', started_at: iso(60), ended_at: iso(30), utc_offset_seconds: 0,
        heart_rate: { avg: 128, max: 171 }, calories: 410, sets: [],
      }), deps)
      assert.equal(finish.status, 200)
      const f = (await finish.json()) as {
        session: { status: string; completed_now: boolean; xp_earned: number; local_date: string }
        stats: { xp_total: number }
      }
      assert.equal(f.session.status, 'completed')
      assert.equal(f.session.completed_now, true)
      assert.ok(f.session.xp_earned > 0)
      assert.equal(f.stats.xp_total, f.session.xp_earned)
      assert.equal(f.session.local_date, iso(30).slice(0, 10))
      assert.equal(db(`select total_workouts from user_stats where user_id = '${ALICE}'`), '1')
      assert.equal(db(`select avg_heart_rate || ',' || max_heart_rate || ',' || calories from sessions where id = '${S1}'`), '128,171,410')
      assert.equal(db(`select completed_at = '${iso(30)}'::timestamptz from sessions where id = '${S1}'`), 't', 'device end time, UTC')
      assert.equal(completions.length, 1)

      // Re-sending the finish with every set is harmless: no double XP, no second hook run.
      const again = await watchSessions(request('/sessions', aliceToken, {
        id: S1, workout_id: 'push', started_at: iso(60), ended_at: iso(30), utc_offset_seconds: 0, sets,
      }), deps)
      assert.equal(again.status, 200)
      const a = (await again.json()) as { session: { completed_now: boolean }; sets: Record<string, unknown[]> }
      assert.equal(a.session.completed_now, false)
      assert.equal(a.sets.duplicate.length, 3)
      assert.equal(db(`select xp_total from user_stats where user_id = '${ALICE}'`), String(f.stats.xp_total))
      assert.equal(completions.length, 1)
    })

    it('a late set for a finished session is stored and stats recompute', async () => {
      const before = Number(db(`select xp_earned from sessions where id = '${S1}'`))
      const res = await watchSessions(request('/sessions', aliceToken, {
        id: S1, workout_id: 'push', started_at: iso(60), sets: [set('set4', id('ohp'), 2, 95, 40)],
      }), deps)
      assert.equal(res.status, 200)
      assert.equal(db(`select count(*) from session_logs where session_id = '${S1}'`), '4')
      assert.ok(Number(db(`select xp_earned from sessions where id = '${S1}'`)) >= before)
    })

    it('watch data appears in the web app history reads', () => {
      // log/past, Home and Progress read sessions + session_logs under RLS.
      const rows = asUser(ALICE, `
        select s.day_type || '|' || s.source || '|' || count(sl.id)
          from sessions s join session_logs sl on sl.session_id = s.id
         where s.completed_at is not null group by s.id;`)
      assert.equal(rows, 'push|watch|4')
      // grind_home_history backs Home's week/month counts and last-trained map.
      const history = JSON.parse(asUser(ALICE, `select grind_home_history(90)::text;`)) as {
        last_trained_by_day: Record<string, string>
        recent_local_dates: string[]
      }
      assert.ok(history.recent_local_dates.includes(iso(30).slice(0, 10)))
      assert.ok(history.last_trained_by_day.push)
      // Bob sees none of it.
      assert.equal(asUser(BOB, `select count(*) from sessions where user_id = '${ALICE}';`), '0')
    })

    it('/today moves on to the next day after the watch workout', async () => {
      // The route also advances the pointer (afterCompletion → rotationStore);
      // even without it the resolver's catch-up sees the newer completion.
      const res = await watchToday(request('/today', aliceToken), deps)
      const body = (await res.json()) as { workout: { id: string } }
      assert.equal(body.workout.id, 'pull')
    })

    it("never lets one user's token touch another user's data", async () => {
      // Bob re-using Alice's session id: refused, Alice's session untouched.
      const clash = await watchSessions(request('/sessions', bobToken, {
        id: S1, workout_id: 'legs', started_at: iso(20), sets: [],
      }), deps)
      assert.equal(clash.status, 409)
      assert.equal(await codeOf(clash), 'session_id_conflict')

      // Bob logging a set against Alice's exercise: that set is rejected.
      const res = await watchSessions(request('/sessions', bobToken, {
        id: id('s2'), workout_id: 'legs', started_at: iso(20),
        sets: [set('bob1', id('squat'), 1, 225, 15), set('bob2', id('bench'), 1, 999, 14)],
      }), deps)
      assert.equal(res.status, 201)
      const r = (await res.json()) as { sets: { accepted: string[]; rejected: { id: string; code: string }[] } }
      assert.deepEqual(r.sets.accepted, [id('bob1')])
      assert.deepEqual(r.sets.rejected.map(x => [x.id, x.code]), [[id('bob2'), 'unknown_exercise']])

      // Bob re-using one of Alice's set ids in his own session.
      const steal = await watchSessions(request('/sessions', bobToken, {
        id: id('s2'), started_at: iso(20), sets: [{ ...set('set1', id('squat'), 2, 1, 10) }],
      }), deps)
      const s = (await steal.json()) as { sets: { rejected: { code: string }[] } }
      assert.equal(s.sets.rejected[0].code, 'set_id_conflict')
      assert.equal(db(`select weight from session_logs where id = '${id('set1')}'`), '140')
    })

    it('refuses what the schema forbids, with stable codes', async () => {
      const unknownDay = await watchSessions(request('/sessions', aliceToken, {
        id: id('s3'), workout_id: 'arms', started_at: iso(20), sets: [],
      }), deps)
      assert.equal(unknownDay.status, 422)
      assert.equal(await codeOf(unknownDay), 'unknown_workout')

      // A finished session with only a warm-up can't complete, and nothing is kept.
      const warmOnly = await watchSessions(request('/sessions', aliceToken, {
        id: id('s4'), workout_id: 'pull', started_at: iso(20), ended_at: iso(5),
        sets: [set('warm', id('row'), 1, 45, 10, { is_warmup: true })],
      }), deps)
      assert.equal(warmOnly.status, 422)
      assert.equal(await codeOf(warmOnly), 'no_working_sets')
      assert.equal(db(`select count(*) from sessions where id = '${id('s4')}'`), '0')

      // The web app already has "pull" open → a partial watch upload for pull conflicts…
      asUser(ALICE, `select start_or_resume_session('pull');`)
      const open = await watchSessions(request('/sessions', aliceToken, {
        id: id('s5'), workout_id: 'pull', started_at: iso(20), sets: [set('p1', id('row'), 1, 135, 10)],
      }), deps)
      assert.equal(open.status, 409)
      assert.equal(await codeOf(open), 'open_session_conflict')
      // …but the same workout uploaded as finished goes through.
      const done = await watchSessions(request('/sessions', aliceToken, {
        id: id('s5'), workout_id: 'pull', started_at: iso(20), ended_at: iso(2), utc_offset_seconds: 0,
        sets: [set('p1', id('row'), 1, 135, 10)],
      }), deps)
      assert.equal(done.status, 201)
      // A second finished "pull" on the same date is refused (one per day, like the web).
      const twice = await watchSessions(request('/sessions', aliceToken, {
        id: id('s6'), workout_id: 'pull', started_at: iso(20), ended_at: iso(1), utc_offset_seconds: 0,
        sets: [set('p2', id('row'), 1, 135, 10)],
      }), deps)
      assert.equal(twice.status, 409)
      assert.equal(await codeOf(twice), 'day_already_logged')
    })
  })

  describe('POST /rep-lab (migration 66)', () => {
    const S1 = id('s1')
    const LAB = id('lab1')
    const wave = (n: number) => Array.from({ length: n }, (_, i) => Math.round(900 * Math.sin(i / 6)))
    const recording = (extra: object = {}) => ({
      id: LAB, session_id: S1, exercise_id: id('bench'), exercise_name: 'Bench', set_number: 1, weight: 135, unit: 'lbs',
      logged_reps: 8, auto_reps: 7, auto_shown: false, typed: true, started_at: iso(56), finished_at: iso(55),
      rate_hz: 12.5, clipped: false, x: wave(300), y: wave(300), z: wave(300), steps: new Array(300).fill(0),
      events: [[1000, 1, 25], [30000, 3, 7, 1, 400, 90]], diag: { sensor: 'receiving' }, app_version: 'test',
      ...extra,
    })

    it('stores a recording once, keeps a later correction, and is owner-only', async () => {
      clock = new Date()
      for (let i = 0; i < 2; i++) {
        const res = await watchRepLab(request('/rep-lab', aliceToken, recording()), deps)
        assert.equal(res.status, 201)
      }
      assert.equal(db(`select count(*) || ',' || array_length(motion_x, 1) || ',' || logged_reps from rep_lab_sets where id = '${LAB}' group by motion_x, logged_reps`), '1,300,8')

      const fix = await watchRepLab(request('/rep-lab', aliceToken, { id: LAB, logged_reps: 9, corrected: true }), deps)
      assert.equal(fix.status, 201)
      // A re-sent recording must not undo the correction.
      await watchRepLab(request('/rep-lab', aliceToken, recording()), deps)
      assert.equal(db(`select logged_reps || ',' || corrected from rep_lab_sets where id = '${LAB}'`), '9,true')

      assert.equal(asUser(ALICE, `select count(*) from rep_lab_sets where id = '${LAB}'`), '1')
      assert.equal(asUser(BOB, `select count(*) from rep_lab_sets where id = '${LAB}'`), '0')
    })

    it("refuses another user's session and cannot be written by a signed-in client", async () => {
      const res = await watchRepLab(request('/rep-lab', bobToken, recording({ id: id('lab2') })), deps)
      assert.equal(res.status, 422)
      assert.equal(await codeOf(res), 'session_not_found')
      assert.throws(() => asUser(ALICE, `insert into rep_lab_sets (id, user_id, session_id, logged_reps) values ('${id('lab3')}', '${ALICE}', '${S1}', 1)`))
    })
  })

  describe('readiness checks, lifting load context and rep tuning (migration 68)', () => {
    const RR = Array.from({ length: 70 }, (_, i) => 950 + (i % 2 ? 25 : -25))
    const check = (cid: string, extra: object = {}) => ({
      id: cid, local_date: '2026-11-16', measured_at: iso(30), duration_s: 60, rr_ms: RR, moving_s: 0, watch_rmssd: 50, app_version: 'test', ...extra,
    })

    it('stores a check with the server-computed numbers, owner-only, and deletion wipes it', async () => {
      clock = new Date()
      const res = await watchReadiness(request('/readiness', aliceToken, check(id('rd1'))), deps)
      assert.equal(res.status, 201)
      assert.equal(db(`select quality || ',' || rmssd || ',' || clean_beats || ',' || array_length(rr_ms, 1) || ',' || watch_rmssd from readiness_checks where id = '${id('rd1')}'`), 'good,50.0,70,70,50.0')
      assert.equal(asUser(ALICE, `select count(*) from readiness_checks where id = '${id('rd1')}'`), '1')
      assert.equal(asUser(BOB, `select count(*) from readiness_checks where id = '${id('rd1')}'`), '0')
      assert.throws(() => asUser(ALICE, `insert into readiness_checks (id, user_id, local_date, measured_at, duration_s, rr_ms, quality) values ('${id('rd9')}', '${ALICE}', '2026-11-16', now(), 60, '{900}', 'good')`))
      // Bob re-sending Alice's id must not overwrite it.
      await watchReadiness(request('/readiness', bobToken, check(id('rd1'), { local_date: '2026-01-01' })), deps)
      assert.equal(db(`select local_date from readiness_checks where id = '${id('rd1')}'`), '2026-11-16')
      // The watch's body context carries it, and the lifting sets.
      const ctx = JSON.parse(db(`select watch_body_context('${ALICE}', '2026-11-16')::text`))
      assert.ok(Array.isArray(ctx.readiness) && ctx.readiness.length >= 1)
      assert.ok(Array.isArray(ctx.strength))
    })

    it('refuses checks while health collection is off; deleting health data removes them', async () => {
      asUser(ALICE, 'select set_health_collection(false);')
      const res = await watchReadiness(request('/readiness', aliceToken, check(id('rd2'))), deps)
      assert.equal(res.status, 201)
      assert.equal(((await res.json()) as { stored: boolean }).stored, false)
      assert.equal(db(`select count(*) from readiness_checks where id = '${id('rd2')}'`), '0')
      asUser(ALICE, 'select set_health_collection(true);')
      await watchReadiness(request('/readiness', aliceToken, check(id('rd3'))), deps)
      // What Settings calls; it runs delete_health_history() inside.
      asUser(ALICE, 'select delete_body_data();')
      assert.equal(db(`select count(*) from readiness_checks where user_id = '${ALICE}'`), '0')
      asUser(ALICE, 'select set_health_collection(true);')
    })

    it('hands the watch only applied tunings for the current counter, owner-only', () => {
      db(`insert into rep_tuning (user_id, exercise_id, algo_version, params, sets_used, default_exact, default_wrong, tuned_exact, tuned_wrong, applied) values
        ('${ALICE}', 'ex-a', 'v1', '{"lag":7}', 25, 10, 0, 20, 0, true),
        ('${ALICE}', 'ex-b', 'v1', '{}', 25, 20, 0, 20, 0, false),
        ('${ALICE}', 'ex-c', 'v0', '{"ac":0.55}', 25, 10, 0, 20, 0, true)
        on conflict do nothing`)
      const got = JSON.parse(db(`set role service_role; select watch_rep_tuning('${ALICE}', 'v1')::text`).split('\n').pop()!)
      assert.deepEqual(got, [{ exercise_id: 'ex-a', params: { lag: 7 } }])
      assert.equal(asUser(BOB, 'select count(*) from rep_tuning'), '0')
      assert.throws(() => asUser(ALICE, `insert into rep_tuning (user_id, exercise_id, algo_version, params, sets_used, default_exact, default_wrong, tuned_exact, tuned_wrong, applied) values ('${ALICE}', 'x', 'v1', '{}', 1, 0, 0, 0, 0, true)`))
      assert.throws(() => asUser(ALICE, `select watch_rep_tuning('${ALICE}', 'v1')`))
    })

    it('counts usable rep lab sets for the nightly job without moving motion', () => {
      const out = db(`select exercise_id || ':' || n from rep_tuning_candidates(now() - interval '1 day') where user_id = '${ALICE}' order by 1`)
      assert.match(out, new RegExp(`${id('bench')}:\\d+`))
    })
  })

  describe('rep lab tape and watch telemetry (migration 67)', () => {
    const S1 = id('s1')
    const TAPE = id('lab-tape')
    const i16 = (vals: number[]) => {
      const b = Buffer.alloc(vals.length * 2)
      vals.forEach((v, i) => b.writeInt16BE(v, 2 * i))
      return b.toString('base64')
    }
    const wave = (n: number) => Array.from({ length: n }, (_, i) => Math.round(900 * Math.sin(i / 6)))

    it('stores the compass, heart rate and beats from a tape recording', async () => {
      clock = new Date()
      const res = await watchRepLab(request('/rep-lab', aliceToken, {
        id: TAPE, session_id: S1, exercise_id: id('bench'), exercise_name: 'Bench', set_number: 2, weight: 135, unit: 'lbs',
        logged_reps: 8, auto_reps: 8, auto_shown: true, typed: false, started_at: iso(56), finished_at: iso(55),
        rate_hz: 12.5, clipped: false, enc: 'i16b64', ax: i16(wave(200)), ay: i16(wave(200)), az: i16(wave(200)),
        mx: i16(wave(200)), my: i16(wave(200)), mz: i16(wave(200)), hr: [100, 104], beats: [600, 590, 610],
        step_marks: [[12, 0], [200, 3]], events: [[1000, 1, 25]], diag: { tape_total: 200 }, app_version: 'test',
      }), deps)
      assert.equal(res.status, 201)
      assert.equal(db(`select array_length(motion_x, 1) || ',' || array_length(mag_z, 1) || ',' || array_to_string(hr, ' ') || ',' || array_to_string(beats, ' ') || ',' || steps[200] from rep_lab_sets where id = '${TAPE}'`), '200,200,100 104,600 590 610,3')
    })

    it('stores crash and workout health records, owner-only and not client-writable', async () => {
      const CRASH = id('crash1')
      for (let i = 0; i < 2; i++) {
        const res = await watchTelemetry(request('/telemetry', aliceToken, {
          id: CRASH, kind: 'unclean_exit', at: iso(30), app_version: 'test', data: { phase: 'set', mem: 190000, upload_codes: [-104] },
        }), deps)
        assert.equal(res.status, 201)
      }
      assert.equal(db(`select count(*) || ',' || kind || ',' || (data->>'mem') from watch_telemetry where id = '${CRASH}' group by kind, data`), '1,unclean_exit,190000')
      assert.equal(asUser(ALICE, `select count(*) from watch_telemetry where id = '${CRASH}'`), '1')
      assert.equal(asUser(BOB, `select count(*) from watch_telemetry where id = '${CRASH}'`), '0')
      assert.throws(() => asUser(ALICE, `insert into watch_telemetry (id, user_id, kind) values ('${id('crash2')}', '${ALICE}', 'session')`))
      // A re-sent id from another account must not overwrite it.
      await watchTelemetry(request('/telemetry', bobToken, { id: CRASH, kind: 'session', data: {} }), deps)
      assert.equal(db(`select kind from watch_telemetry where id = '${CRASH}'`), 'unclean_exit')
    })
  })
})
