/**
 * Watch API, no database: token parsing, validation, the /today payload, and
 * the HTTP layer (status codes + `{ error: { code, message } }` shape) driven
 * through fake deps. watchApi.db.test.ts runs the same handlers against the
 * real migrations in Postgres.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hashWatchToken, readBearerToken } from '../token'
import { buildTodayPayload, parseRepsTarget, MAX_TODAY_EXERCISES, type TodayContext } from '../today'
import { watchPing, watchSessions, watchToday, toSyncPayload, type WatchDeps, type RpcResult } from '../handlers'
import { watchSessionSchema } from '../schema'

const TOKEN = 'gwt_' + 'a1'.repeat(32)
const NOW = new Date('2026-11-16T18:00:00Z')
const USER = '11111111-1111-4111-8111-111111111111'
const EX1 = '22222222-2222-4222-8222-222222222222'
const SESSION = '33333333-3333-4333-8333-333333333333'
const SET1 = '44444444-4444-4444-8444-444444444444'
const SET2 = '55555555-5555-4555-8555-555555555555'

type Call = { fn: string; args: Record<string, unknown> }

function fakeDeps(
  handlers: Record<string, (args: Record<string, unknown>) => RpcResult> = {},
): WatchDeps & { calls: Call[]; completions: unknown[] } {
  const calls: Call[] = []
  const completions: unknown[] = []
  return {
    calls,
    completions,
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      if (fn === 'watch_authenticate' && !handlers[fn]) {
        return { data: { status: 'ok', user_id: USER, device_id: 'd1', device: 'Fenix' }, error: null }
      }
      const h = handlers[fn]
      if (!h) throw new Error(`unexpected rpc ${fn}`)
      return h(args)
    },
    afterCompletion: async info => {
      completions.push(info)
    },
    now: () => NOW,
    log: () => {},
  }
}

function req(path: string, init: { method?: string; token?: string | null; body?: unknown; rawBody?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.token !== null) headers.authorization = `Bearer ${init.token ?? TOKEN}`
  return new Request(`https://grind.test/api/watch/v1${path}`, {
    method: init.method ?? (init.body !== undefined || init.rawBody !== undefined ? 'POST' : 'GET'),
    headers,
    body: init.rawBody ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
  })
}

async function errorOf(res: Response) {
  const body = (await res.json()) as { error: { code: string; message: string; details?: unknown[] } }
  assert.equal(typeof body.error.code, 'string')
  assert.equal(typeof body.error.message, 'string')
  return body.error
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION,
    workout_id: 'push',
    started_at: '2026-11-16T17:00:00Z',
    sets: [
      { id: SET1, exercise_id: EX1, set_number: 1, reps: 8, weight: 100, unit: 'kg', completed_at: '2026-11-16T17:05:00Z', rest_seconds: 90 },
    ],
    ...overrides,
  }
}

describe('watch tokens', () => {
  it('accepts only a well-formed Bearer token', () => {
    assert.deepEqual(readBearerToken(null), { ok: false, reason: 'missing' })
    assert.deepEqual(readBearerToken('  '), { ok: false, reason: 'missing' })
    assert.deepEqual(readBearerToken(TOKEN), { ok: false, reason: 'malformed' })
    assert.deepEqual(readBearerToken('Basic abc'), { ok: false, reason: 'malformed' })
    assert.deepEqual(readBearerToken('Bearer gwt_short'), { ok: false, reason: 'malformed' })
    assert.deepEqual(readBearerToken(`Bearer ${TOKEN.toUpperCase()}`), { ok: false, reason: 'malformed' })
    assert.deepEqual(readBearerToken(`bearer ${TOKEN}`), { ok: true, token: TOKEN })
  })

  it('hashes to lowercase hex SHA-256 (what the SQL stores)', () => {
    assert.equal(hashWatchToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('auth failures', () => {
  it('401 missing_token without calling the database', async () => {
    const deps = fakeDeps()
    const res = await watchPing(req('/ping', { token: null }), deps)
    assert.equal(res.status, 401)
    assert.match(res.headers.get('www-authenticate') ?? '', /^Bearer/)
    assert.equal((await errorOf(res)).code, 'missing_token')
    assert.equal(deps.calls.length, 0)
  })

  it('401 invalid_token for a malformed token without calling the database', async () => {
    const deps = fakeDeps()
    const res = await watchPing(req('/ping', { token: 'nope' }), deps)
    assert.equal(res.status, 401)
    assert.equal((await errorOf(res)).code, 'invalid_token')
    assert.equal(deps.calls.length, 0)
  })

  it('401 for an unknown token, 401 token_revoked for a revoked one', async () => {
    for (const [status, code] of [['invalid', 'invalid_token'], ['revoked', 'token_revoked']]) {
      const deps = fakeDeps({ watch_authenticate: () => ({ data: { status }, error: null }) })
      const res = await watchSessions(req('/sessions', { body: session() }), deps)
      assert.equal(res.status, 401)
      assert.equal((await errorOf(res)).code, code)
      assert.equal(deps.calls.length, 1, 'never reaches the sync RPC')
      assert.equal(deps.calls[0].args.p_token_hash, hashWatchToken(TOKEN), 'sends the hash, not the token')
    }
  })

  it('429 with Retry-After when rate limited', async () => {
    const deps = fakeDeps({ watch_authenticate: () => ({ data: { status: 'rate_limited', retry_after: 17 }, error: null }) })
    const res = await watchToday(req('/today'), deps)
    assert.equal(res.status, 429)
    assert.equal(res.headers.get('retry-after'), '17')
    assert.equal((await errorOf(res)).code, 'rate_limited')
  })

  it('503 when the auth lookup itself fails', async () => {
    const deps = fakeDeps({ watch_authenticate: () => ({ data: null, error: { message: 'boom' } }) })
    const res = await watchPing(req('/ping'), deps)
    assert.equal(res.status, 503)
    assert.equal((await errorOf(res)).code, 'service_unavailable')
  })
})

describe('GET /ping', () => {
  it('returns server time and the device name', async () => {
    const res = await watchPing(req('/ping'), fakeDeps())
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await res.json(), { ok: true, api_version: 1, server_time: NOW.toISOString(), device: 'Fenix' })
  })
})

describe('POST /sessions validation', () => {
  async function expect422(body: unknown, pathRe: RegExp) {
    const deps = fakeDeps()
    const res = await watchSessions(req('/sessions', { body }), deps)
    assert.equal(res.status, 422)
    const err = await errorOf(res)
    assert.equal(err.code, 'validation_failed')
    assert.ok(Array.isArray(err.details) && err.details.length > 0)
    assert.match(err.message, pathRe)
    assert.ok(!deps.calls.some(c => c.fn === 'watch_sync_session'), 'invalid input never reaches SQL')
  }

  it('rejects bad ids, units, numbers and timestamps', async () => {
    await expect422(session({ id: 'not-a-uuid' }), /^id:/)
    await expect422(session({ started_at: '2026-11-16 17:00' }), /^started_at:/)
    await expect422(session({ ended_at: '2026-11-16T16:00:00Z' }), /^ended_at: must not be before/)
    await expect422(session({ sets: [{ ...session().sets[0], unit: 'stone' }] }), /^sets\.0\.unit:/)
    await expect422(session({ sets: [{ ...session().sets[0], reps: -1 }] }), /^sets\.0\.reps:/)
    await expect422(session({ sets: [{ ...session().sets[0], reps: 2.5 }] }), /^sets\.0\.reps:/)
    await expect422(session({ sets: [{ ...session().sets[0], weight: 'heavy' }] }), /^sets\.0\.weight:/)
    await expect422(session({ heart_rate: { avg: 400 } }), /^heart_rate\.avg:/)
    await expect422(session({ user_id: USER }), /unrecognized/i)
  })

  it('rejects timestamps in the future or too old', async () => {
    await expect422(session({ started_at: '2026-11-16T19:00:00Z' }), /^started_at: is in the future/)
    await expect422(session({ started_at: '2020-01-01T00:00:00Z' }), /^started_at: is more than 730 days old/)
  })

  it('rejects duplicate set ids and duplicate slots inside one request', async () => {
    const s = session().sets[0]
    await expect422(session({ sets: [s, { ...s, set_number: 2 }] }), /duplicate set id/)
    await expect422(session({ sets: [s, { ...s, id: SET2 }] }), /share an exercise_id and set_number/)
  })

  it('400 invalid_json and 413 payload_too_large', async () => {
    let res = await watchSessions(req('/sessions', { rawBody: '{"id":' }), fakeDeps())
    assert.equal(res.status, 400)
    assert.equal((await errorOf(res)).code, 'invalid_json')

    res = await watchSessions(req('/sessions', { rawBody: JSON.stringify({ pad: 'x'.repeat(70_000) }) }), fakeDeps())
    assert.equal(res.status, 413)
    assert.equal((await errorOf(res)).code, 'payload_too_large')
  })

  it('converts kg to canonical lbs but keeps what the device sent', () => {
    const payload = toSyncPayload(watchSessionSchema.parse(session()))
    assert.equal(payload.sets[0].weight_lbs, 220.462)
    assert.equal(payload.sets[0].entered_weight, 100)
    assert.equal(payload.sets[0].entered_unit, 'kg')
    const lbs = toSyncPayload(watchSessionSchema.parse(session({ sets: [{ ...session().sets[0], unit: 'lbs', weight: 135 }] })))
    assert.equal(lbs.sets[0].weight_lbs, 135)
  })

  it('normalizes offsets to UTC', () => {
    const p = toSyncPayload(watchSessionSchema.parse(session({ started_at: '2026-11-16T12:00:00-05:00' })))
    assert.equal(p.started_at, '2026-11-16T17:00:00.000Z')
  })
})

describe('POST /sessions responses', () => {
  const ok = (created: boolean, completedNow = false): RpcResult => ({
    data: {
      session: {
        id: SESSION,
        workout_id: 'push',
        status: completedNow ? 'completed' : 'open',
        created,
        completed_now: completedNow,
        completed_at: completedNow ? '2026-11-16T17:50:00.000Z' : null,
      },
      sets: { accepted: [SET1], updated: [], duplicate: [], rejected: [] },
    },
    error: null,
  })

  it('201 when the session is new, 200 on a re-upload', async () => {
    let deps = fakeDeps({ watch_sync_session: () => ok(true) })
    let res = await watchSessions(req('/sessions', { body: session() }), deps)
    assert.equal(res.status, 201)
    const sync = deps.calls.find(c => c.fn === 'watch_sync_session')!
    assert.equal(sync.args.p_user, USER, 'user id comes from the token, never the body')

    deps = fakeDeps({ watch_sync_session: () => ok(false) })
    res = await watchSessions(req('/sessions', { body: session() }), deps)
    assert.equal(res.status, 200)
    assert.equal(deps.completions.length, 0)
  })

  it('runs the post-completion hook only when this request completed the session', async () => {
    const deps = fakeDeps({ watch_sync_session: () => ok(false, true) })
    await watchSessions(req('/sessions', { body: session({ ended_at: '2026-11-16T17:50:00Z' }) }), deps)
    assert.deepEqual(deps.completions, [
      { userId: USER, sessionId: SESSION, workoutId: 'push', completedAt: '2026-11-16T17:50:00.000Z' },
    ])
  })

  it('maps SQL refusals to stable codes', async () => {
    const cases: Array<[string, number, string]> = [
      ['WATCH_SESSION_ID_CONFLICT', 409, 'session_id_conflict'],
      ['WATCH_OPEN_SESSION_CONFLICT', 409, 'open_session_conflict'],
      ['WATCH_DAY_ALREADY_LOGGED', 409, 'day_already_logged'],
      ['WATCH_UNKNOWN_WORKOUT', 422, 'unknown_workout'],
      ['WATCH_WORKOUT_REQUIRED', 422, 'workout_required'],
      ['WATCH_NO_WORKING_SETS', 422, 'no_working_sets'],
      ['something unexpected', 500, 'internal_error'],
    ]
    for (const [message, status, code] of cases) {
      const deps = fakeDeps({ watch_sync_session: () => ({ data: null, error: { message } }) })
      const res = await watchSessions(req('/sessions', { body: session() }), deps)
      assert.equal(res.status, status, message)
      assert.equal((await errorOf(res)).code, code)
    }
  })

  it('500 internal_error (not a crash) when a dependency throws', async () => {
    const deps = fakeDeps({ watch_sync_session: () => { throw new Error('socket hang up') } })
    const res = await watchSessions(req('/sessions', { body: session() }), deps)
    assert.equal(res.status, 500)
    assert.equal((await errorOf(res)).code, 'internal_error')
  })
})

describe('GET /today payload', () => {
  const ex = (o: Partial<TodayContext['exercises'][number]>): TodayContext['exercises'][number] => ({
    id: EX1, name: 'Bench Press', day_type: 'push', active: true, sets_target: 3, reps_target: '8-12',
    weight_target: null, rest_seconds: null, sort_order: 0, last_weight: null, ...o,
  })
  const ctx = (o: Partial<TodayContext> = {}): TodayContext => ({
    local_date: '2026-11-16',
    is_rest_day: false,
    exercises: [
      ex({ id: 'b', name: 'Incline', sort_order: 1, weight_target: 135, rest_seconds: 120 }),
      ex({ id: 'a', name: 'Bench', sort_order: 0, last_weight: 225, reps_target: '5' }),
      ex({ id: 'c', name: 'Off', sort_order: 2, active: false }),
      ex({ id: 'p', name: 'Row', day_type: 'pull' }),
    ],
    rotation: null,
    flex_days: [],
    last_completion: null,
    ...o,
  })

  it('parses rep targets', () => {
    assert.deepEqual(parseRepsTarget('8-12'), [8, 12])
    assert.deepEqual(parseRepsTarget('8–12'), [8, 12])
    assert.deepEqual(parseRepsTarget('10'), [10, null])
    assert.deepEqual(parseRepsTarget('10-10'), [10, null])
    assert.deepEqual(parseRepsTarget('AMRAP'), [null, null])
  })

  it('returns the up-next day in plan order, active exercises only', () => {
    const p = buildTodayPayload(ctx(), 'lbs')
    assert.ok(p.workout)
    assert.equal(p.workout.id, 'pull', 'auto rotation, no history → alphabetical first')
    const afterPull = buildTodayPayload(
      ctx({ last_completion: { day: 'pull', completed_at: '2026-11-15T18:00:00Z' } }),
      'lbs',
    )
    assert.ok(afterPull.workout)
    assert.equal(afterPull.workout.id, 'push')
    assert.deepEqual(afterPull.workout.exercises, [
      { id: 'a', name: 'Bench', sets: 3, reps: 5, reps_max: null, weight: 225, rest: null },
      { id: 'b', name: 'Incline', sets: 3, reps: 8, reps_max: 12, weight: 135, rest: 120 },
    ])
  })

  it('converts weights for unit=kg', () => {
    const p = buildTodayPayload(ctx({ last_completion: { day: 'pull', completed_at: '2026-11-15T18:00:00Z' } }), 'kg')
    assert.ok(p.workout)
    assert.equal(p.unit, 'kg')
    assert.equal(p.workout.exercises[0].weight, 102.1)
  })

  it('clear empty responses for rest days and no plan', () => {
    assert.deepEqual(buildTodayPayload(ctx({ is_rest_day: true }), 'lbs'), {
      date: '2026-11-16', unit: 'lbs', workout: null, reason: 'rest_day',
    })
    assert.deepEqual(buildTodayPayload(ctx({ exercises: [] }), 'lbs'), {
      date: '2026-11-16', unit: 'lbs', workout: null, reason: 'no_plan',
    })
  })

  it('stays under 4 KB even for a maxed-out day', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      ex({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: 'W'.repeat(80), sort_order: i, weight_target: 1234.5, rest_seconds: 300 }),
    )
    const p = buildTodayPayload(ctx({ exercises: many }), 'kg')
    assert.ok(p.workout)
    assert.equal(p.workout.exercises.length, MAX_TODAY_EXERCISES)
    const bytes = Buffer.byteLength(JSON.stringify(p))
    assert.ok(bytes < 4096, `payload is ${bytes} bytes`)
  })

  it('422 for bad query parameters', async () => {
    const res = await watchToday(req('/today?unit=stone'), fakeDeps())
    assert.equal(res.status, 422)
    assert.equal((await errorOf(res)).code, 'validation_failed')
  })
})
