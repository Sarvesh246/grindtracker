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
import { watchDaily, watchPing, watchRepLab, watchSessions, watchTelemetry, watchToday, watchReadiness, decodeI16, stepsPerSample, toSyncPayload, type WatchDeps, type RpcResult } from '../handlers'
import { watchSessionSchema } from '../schema'
import { todayBody } from '../body'

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
      days: [{ id: 'pull', name: 'Pull' }, { id: 'push', name: 'Push' }],
    })
    assert.deepEqual(buildTodayPayload(ctx({ exercises: [] }), 'lbs'), {
      date: '2026-11-16', unit: 'lbs', workout: null, reason: 'no_plan',
    })
  })

  it('lists every enabled day for the watch picker', () => {
    const p = buildTodayPayload(ctx(), 'lbs')
    assert.ok(p.workout)
    assert.deepEqual(p.days, [{ id: 'pull', name: 'Pull' }, { id: 'push', name: 'Push' }])
    const none = buildTodayPayload(ctx({ exercises: [] }), 'lbs')
    assert.equal('days' in none, false, 'no plan, nothing to pick from')
  })

  it('returns the requested day instead of the up-next one', () => {
    const p = buildTodayPayload(ctx(), 'lbs', 'push')
    assert.ok(p.workout)
    assert.equal(p.workout.id, 'push', 'up-next is pull; the user picked push')
    assert.deepEqual(p.workout.exercises.map(e => e.id), ['a', 'b'])
    assert.equal(p.days.length, 2, 'the list is the same whichever day is picked')
  })

  it('ignores an unknown or disabled day instead of failing', () => {
    const unknown = buildTodayPayload(ctx(), 'lbs', 'legs')
    assert.ok(unknown.workout)
    assert.equal(unknown.workout.id, 'pull')
    const disabledOnly = ctx({ exercises: [ex({ id: 'x', day_type: 'legs', active: false }), ex({ id: 'p', day_type: 'pull' })] })
    const p = buildTodayPayload(disabledOnly, 'lbs', 'legs')
    assert.ok(p.workout)
    assert.equal(p.workout.id, 'pull', 'legs has no active exercises, so it is not a day')
  })

  it('honors a picked day even on a rest day', () => {
    const p = buildTodayPayload(ctx({ is_rest_day: true }), 'lbs', 'push')
    assert.ok(p.workout)
    assert.equal(p.workout.id, 'push')
  })

  it('follows rotation order, not alphabetical', () => {
    const p = buildTodayPayload(
      ctx({ rotation: { mode: 'manual', sequence: ['push', 'pull'], current_index: 0 } as TodayContext['rotation'] }),
      'lbs',
    )
    assert.ok(p.workout)
    assert.deepEqual(p.days.map(d => d.id), ['push', 'pull'])
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

  it('accepts ?day= and still rejects other unknown parameters', async () => {
    const ok = await watchToday(req('/today?day=push'), fakeDeps())
    assert.notEqual(ok.status, 422)
    const bad = await watchToday(req('/today?dya=push'), fakeDeps())
    assert.equal(bad.status, 422)
  })
})

describe('GRIND Body uploads', () => {
  const synced = () => ({
    data: { session: { id: SESSION, workout_id: 'push', created: true, completed_now: false, completed_at: null } },
    error: null,
  })

  it('stores heart rate after the session, with per-set numbers', async () => {
    let body: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_sync_session: synced,
      watch_store_session_body: args => {
        body = args.p_body as Record<string, unknown>
        return { data: { sets_updated: 1 }, error: null }
      },
    })
    const s = session({
      hr: { trace: [90, 0, 120], step: 5, zones: [106, 127, 148, 169, 190, 211], zone_seconds: [10, 20, 30, 0, 0], training_effect: 1.24 },
    })
    ;(s.sets as Record<string, unknown>[])[0].hr_peak = 150
    ;(s.sets as Record<string, unknown>[])[0].hr_rest_drop_60 = 28
    const res = await watchSessions(req('/sessions', { body: s }), deps)
    assert.equal(res.status, 201)
    assert.deepEqual(deps.calls.map(c => c.fn), ['watch_authenticate', 'watch_sync_session', 'watch_store_session_body'])
    assert.ok(body)
    const b = body as Record<string, unknown>
    assert.deepEqual(b.trace, [90, 0, 120])
    assert.equal(b.training_effect, 1.2)
    assert.deepEqual(b.sets, [{ id: SET1, hr_peak: 150, hr_end: null, hr_rest_drop_60: 28 }])
  })

  it('still saves the workout when storing heart rate fails', async () => {
    const deps = fakeDeps({
      watch_sync_session: synced,
      watch_store_session_body: () => ({ data: null, error: { message: 'relation does not exist' } }),
    })
    const s = session({ hr: { zone_seconds: [1, 2, 3, 4, 5] } })
    const res = await watchSessions(req('/sessions', { body: s }), deps)
    assert.equal(res.status, 201)
  })

  it('skips the body call for uploads without heart rate', async () => {
    const deps = fakeDeps({ watch_sync_session: synced })
    const res = await watchSessions(req('/sessions', { body: session() }), deps)
    assert.equal(res.status, 201)
    assert.ok(!deps.calls.some(c => c.fn === 'watch_store_session_body'))
  })

  it('rejects an oversized trace', async () => {
    const res = await watchSessions(req('/sessions', { body: session({ hr: { trace_b64: 'A'.repeat(57_604) } }) }), fakeDeps())
    assert.equal(res.status, 422)
  })

  it('decodes a one-byte-a-reading trace, a byte over 250 as no reading', async () => {
    let body: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_sync_session: synced,
      watch_store_session_body: args => {
        body = args.p_body as Record<string, unknown>
        return { data: { sets_updated: 0 }, error: null }
      },
    })
    const b64 = Buffer.from([90, 0, 120, 255]).toString('base64')
    const res = await watchSessions(req('/sessions', { body: session({ hr: { trace_b64: b64, step: 1 } }) }), deps)
    assert.equal(res.status, 201)
    assert.deepEqual((body as unknown as Record<string, unknown>).trace, [90, 0, 120, 0])
    assert.equal((body as unknown as Record<string, unknown>).step, 1)
  })

  it('a 2-hour one-second trace with 40 sets fits the 64 KB body limit', () => {
    const sets = Array.from({ length: 40 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, exercise_id: EX1, set_number: i + 1, reps: 12,
      weight: 1234.5, unit: 'lbs', completed_at: '2026-11-16T17:05:00Z', rest_seconds: 300, hr_peak: 199, hr_end: 180, hr_rest_drop_60: 45,
    }))
    const trace_b64 = Buffer.alloc(7200, 188).toString('base64')
    const bytes = Buffer.byteLength(JSON.stringify(session({ sets, hr: { trace_b64, step: 1, zone_seconds: [1, 2, 3, 4, 5] } })))
    assert.ok(bytes < 64 * 1024, `payload is ${bytes} bytes`)
  })

  it('a 2-hour trace with 40 sets fits the 64 KB body limit', () => {
    const sets = Array.from({ length: 40 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, exercise_id: EX1, set_number: i + 1, reps: 12,
      weight: 1234.5, unit: 'lbs', completed_at: '2026-11-16T17:05:00Z', rest_seconds: 300, hr_peak: 199, hr_end: 180, hr_rest_drop_60: 45,
    }))
    const bytes = Buffer.byteLength(JSON.stringify(session({ sets, hr: { trace: Array(1440).fill(188), step: 5, zone_seconds: [1, 2, 3, 4, 5] } })))
    assert.ok(bytes < 64 * 1024, `payload is ${bytes} bytes`)
  })
})

describe('POST /daily', () => {
  const series = (f: (i: number) => number | null) => Array.from({ length: 96 }, (_, i) => f(i))

  it('passes the raw heart rate and the watch diagnostics through', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const diag = {
      taken_at: '2026-11-16T19:14:03Z', battery: 61, charging: false, free_mem: 21000, total_mem: 65536,
      part: '006-B4766-00', fw: '21.19', ciq: '5.1.1', prev_bg_at: '2026-11-16T18:59:10Z', prev_bg_code: 200, period_s: 900,
      probe: { bb: [36, 4], spo2_h: -1, temp_h: -3 },
    }
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', source: 'background', hr_raw: { t: [69000, 69120], v: [62, 64] }, diag } }), deps)
    assert.equal(res.status, 200)
    assert.deepEqual((day as unknown as Record<string, unknown>).hr_raw, { t: [69000, 69120], v: [62, 64] })
    assert.deepEqual((day as unknown as Record<string, unknown>).diag, diag)
  })

  it('places respiration at the sync bucket and accepts the workout HR counts', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const diag = { taken_at: '2026-11-16T19:14:03Z', wk_hr: [2400, 12, 2300, 100] }
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', bucket: 5, respiration: 14, diag } }), deps)
    assert.equal(res.status, 200)
    const resp = (day as unknown as Record<string, (number | null)[]>).resp_series
    assert.equal(resp.length, 96)
    assert.equal(resp[5], 14)
    assert.equal(resp.filter(v => v != null).length, 1)
    assert.deepEqual((day as unknown as Record<string, unknown>).diag, diag)
  })

  it('queues one push on a morning snapshot after a strong night, and none outside the morning', async () => {
    const shift = (d: number) => {
      const t = new Date('2026-11-16T12:00:00')
      t.setDate(t.getDate() + d)
      return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
    }
    const flat = (v: number) => Array.from({ length: 96 }, (_, i) => (i < 24 ? v : null))
    const bb = (gain: number) => Array.from({ length: 96 }, (_, i) => (i < 32 ? Math.round(20 + (gain * i) / 31) : null))
    const days = [...Array.from({ length: 10 }, (_, k) => {
      const w = k % 3 - 1
      return { local_date: shift(k - 10), hr_series: flat(58 + w), stress_series: flat(12 + 2 * w), bb_series: bb(50 + 4 * w) }
    }), { local_date: '2026-11-16', hr_series: flat(70), stress_series: flat(35), bb_series: bb(10) }]
    const queued: unknown[] = []
    const deps = fakeDeps({
      watch_upsert_daily: () => ({ data: { local_date: '2026-11-16' }, error: null }),
      watch_body_context: () => ({ data: { days, sessions: [], readiness: [], strength: [], labels: [], prefs: null }, error: null }),
      watch_queue_body_signal: args => {
        queued.push(args)
        return { data: true, error: null }
      },
    })
    assert.equal((await watchDaily(req('/daily', { body: { date: '2026-11-16', bucket: 30 } }), deps)).status, 200)
    assert.equal(queued.length, 1)
    const payload = (queued[0] as { p_payload: { title: string; url: string } }).p_payload
    assert.match(payload.title, /fighting something/)
    assert.equal(payload.url, '/progress/health')
    assert.equal((await watchDaily(req('/daily', { body: { date: '2026-11-16', bucket: 70 } }), deps)).status, 200)
    assert.equal(queued.length, 1)
  })

  it('a failed signal check never fails the upload', async () => {
    const deps = fakeDeps({
      watch_upsert_daily: () => ({ data: { local_date: '2026-11-16' }, error: null }),
      watch_body_context: () => ({ data: null, error: { message: 'boom' } }),
    })
    assert.equal((await watchDaily(req('/daily', { body: { date: '2026-11-16', bucket: 30 } }), deps)).status, 200)
  })

  it('places wrist temperature at the bucket in tenths of a degree', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', bucket: 70, temperature: 33.47 } }), deps)
    assert.equal(res.status, 200)
    assert.equal((day as unknown as Record<string, (number | null)[]>).temp_series[70], 335)
  })

  it('422 on a respiration rate no one breathes at', async () => {
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', bucket: 5, respiration: 90 } }), fakeDeps())
    assert.equal(res.status, 422)
  })

  it('a bad raw heart-rate series drops hr_raw, not the day', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', steps: 4000, hr_raw: { t: [1, 2], v: [60] } } }), deps)
    assert.equal(res.status, 200)
    assert.equal((day as unknown as Record<string, unknown>).hr_raw, null)
    assert.equal((day as unknown as Record<string, unknown>).steps, 4000)
  })

  it('a probe age stamped ahead of the watch clock is clamped to 0, not a 422', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const diag = { taken_at: '2026-11-16T19:14:03Z', probe: { bb_h: [36, -5], stress_h: [20, 3], spo2_h: -1 } }
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', steps: 4000, diag } }), deps)
    assert.equal(res.status, 200)
    const d = day as unknown as Record<string, unknown>
    assert.deepEqual((d.diag as { probe: unknown }).probe, { bb_h: [36, 0], stress_h: [20, 3], spo2_h: -1 })
    assert.equal(d.steps, 4000, 'the day still lands')
  })

  it('a bad diagnostic value drops diag, never the day', async () => {
    let day: Record<string, unknown> | null = null
    let upserts = 0
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        upserts++
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const diag = { taken_at: '2026-11-16T19:14:03Z', battery: 150 }
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', steps: 4000, diag } }), deps)
    assert.equal(res.status, 200)
    assert.equal(upserts, 1)
    assert.equal((day as unknown as Record<string, unknown>).diag, null)
    assert.equal((day as unknown as Record<string, unknown>).steps, 4000)
  })

  it('sends the Body Battery and stress series, not server-derived aggregates', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const res = await watchDaily(req('/daily', {
      body: {
        date: '2026-11-16',
        body_battery: series(i => (i >= 28 && i < 72 ? 90 - Math.floor(i / 2) : null)),
        stress: series(i => (i >= 28 && i < 72 ? (i < 50 ? 20 : 40) : null)),
        body_battery_now: 30,
        resting_hr: 58,
        recovery_hours: 2,
        steps: 6203,
      },
    }), deps)
    assert.equal(res.status, 200)
    const d = day as unknown as Record<string, unknown>
    assert.equal(d.bb_high, undefined, 'migration 72 derives Body Battery high from the series')
    assert.equal(d.bb_latest, undefined)
    assert.equal((d.bb as unknown[]).length, 96)
    assert.equal(d.resting_hr, 58)
    assert.equal(typeof d.stress_avg, 'number')
  })

  it('places running totals at the sync bucket and passes heart rate and source through', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    const res = await watchDaily(req('/daily', {
      body: {
        date: '2026-11-16',
        heart_rate: series(i => (i >= 40 && i < 44 ? 72 : null)),
        bucket: 43,
        steps: 5120,
        active_minutes: 22,
        source: 'background',
      },
    }), deps)
    assert.equal(res.status, 200)
    const d = day as unknown as Record<string, unknown>
    const steps = d.steps_series as (number | null)[]
    assert.equal(steps.length, 96)
    assert.equal(steps[43], 5120)
    assert.equal(steps.filter(v => v != null).length, 1)
    assert.equal((d.active_series as (number | null)[])[43], 22)
    assert.equal(d.floors_series, null)
    assert.equal((d.hr as (number | null)[])[41], 72)
    assert.equal(d.source, 'background')
  })

  it('defaults the source to the app and leaves curves out without a bucket', async () => {
    let day: Record<string, unknown> | null = null
    const deps = fakeDeps({
      watch_upsert_daily: args => {
        day = args.p_day as Record<string, unknown>
        return { data: { local_date: '2026-11-16' }, error: null }
      },
    })
    await watchDaily(req('/daily', { body: { date: '2026-11-16', steps: 100 } }), deps)
    const d = day as unknown as Record<string, unknown>
    assert.equal(d.source, 'app')
    assert.equal(d.steps_series, null)
  })

  it('422 for an unknown source or out-of-range bucket', async () => {
    assert.equal((await watchDaily(req('/daily', { body: { date: '2026-11-16', source: 'cron' } }), fakeDeps())).status, 422)
    assert.equal((await watchDaily(req('/daily', { body: { date: '2026-11-16', bucket: 96 } }), fakeDeps())).status, 422)
  })

  it('422 for a series of the wrong length', async () => {
    const res = await watchDaily(req('/daily', { body: { date: '2026-11-16', body_battery: [1, 2, 3] } }), fakeDeps())
    assert.equal(res.status, 422)
  })

  it('a chunked body with no Content-Length is cut off at the cap, not read to the end', async () => {
    let pulls = 0
    const chunk = new Uint8Array(16 * 1024).fill(0x20)
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls++
          if (pulls > 1000) controller.close()
          else controller.enqueue(chunk)
        },
      },
      { highWaterMark: 0 },
    )
    const request = new Request('https://grind.test/api/watch/v1/daily', {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const deps = fakeDeps()
    const res = await watchDaily(request, deps)
    assert.equal(res.status, 413)
    assert.equal((await errorOf(res)).code, 'payload_too_large')
    assert.ok(pulls <= 8, `read ${pulls} chunks of 16 KB before stopping`)
    assert.deepEqual(deps.calls.map(c => c.fn), ['watch_authenticate'], 'never reaches SQL')
  })

  it('needs a token', async () => {
    const res = await watchDaily(req('/daily', { token: null, body: { date: '2026-11-16' } }), fakeDeps())
    assert.equal(res.status, 401)
  })
})

describe('/today body', () => {
  it('adds Charge when there is enough data, and survives a failed read', async () => {
    const todayCtx = { local_date: '2026-11-16', is_rest_day: false, exercises: [], rotation: null, flex_days: [], last_completion: null }
    const withBody = await watchToday(req('/today'), fakeDeps({
      watch_today_context: () => ({ data: todayCtx, error: null }),
      watch_body_context: () => ({
        data: { days: [{ local_date: '2026-11-16', bb_wake: 80, recovery_hours: 0 }], sessions: [], prefs: { coach_uses_body: true, smart_rest: true } },
        error: null,
      }),
    }))
    const j = (await withBody.json()) as { body: { charge: { score: number; label: string }; smart_rest: boolean } }
    assert.equal(j.body.charge.label, 'Primed')
    assert.equal(j.body.smart_rest, true)

    const failed = await watchToday(req('/today'), fakeDeps({
      watch_today_context: () => ({ data: todayCtx, error: null }),
      watch_body_context: () => ({ data: null, error: { message: 'missing function' } }),
    }))
    assert.equal(failed.status, 200)
    assert.equal(((await failed.json()) as { body: unknown }).body, null)
  })
})

describe('POST /telemetry', () => {
  const crash = (overrides: Record<string, unknown> = {}) => ({
    id: SET1, kind: 'unclean_exit', at: '2026-11-16T17:04:00Z', app_version: '2026-11-18b',
    data: { phase: 'set', mem: 180000, mem_total: 786432, battery: 54, upload_codes: [-104, 503], part: '006-B4766-00' },
    ...overrides,
  })

  it('stores a health record for the token owner', async () => {
    const deps = fakeDeps({ watch_store_telemetry: () => ({ data: { id: SET1, stored: true }, error: null }) })
    const res = await watchTelemetry(req('/telemetry', { body: crash() }), deps)
    assert.equal(res.status, 201)
    const call = deps.calls.find(c => c.fn === 'watch_store_telemetry')!
    assert.equal(call.args.p_user, USER)
    assert.equal((call.args.p_row as { kind: string }).kind, 'unclean_exit')
  })

  it('rejects unknown kinds, nested data and too many fields', async () => {
    for (const body of [
      crash({ kind: 'debug' }),
      crash({ data: { nested: { a: 1 } } }),
      crash({ data: Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`k${i}`, i])) }),
      crash({ extra: true }),
    ]) {
      const res = await watchTelemetry(req('/telemetry', { body }), fakeDeps())
      assert.equal(res.status, 422)
    }
  })

  it('a database failure is a retryable 503', async () => {
    const down = fakeDeps({ watch_store_telemetry: () => ({ data: null, error: { message: 'function does not exist' } }) })
    const res = await watchTelemetry(req('/telemetry', { body: crash() }), down)
    assert.equal(res.status, 503)
  })
})

describe('POST /rep-lab', () => {
  const motion = (n: number) => Array.from({ length: n }, (_, i) => Math.round(1000 * Math.sin(i / 5)))
  const recording = (overrides: Record<string, unknown> = {}) => ({
    id: SET1, session_id: SESSION, exercise_id: EX1, exercise_name: 'Bench', set_number: 1,
    weight: 135, unit: 'lbs', logged_reps: 10, auto_reps: 9, auto_shown: false, typed: true,
    started_at: '2026-11-16T17:04:00Z', finished_at: '2026-11-16T17:05:00Z', rate_hz: 12.5, clipped: false,
    x: motion(500), y: motion(500), z: motion(500), steps: new Array(500).fill(0),
    events: [[1200, 1, 25], [9800, 3, 9, 1, 410, 96]], diag: { sensor: 'receiving', batches: 40 }, app_version: '1.0',
    ...overrides,
  })

  it('stores a full recording for the token owner', async () => {
    const deps = fakeDeps({ watch_store_rep_lab: () => ({ data: { id: SET1, stored: true }, error: null }) })
    const res = await watchRepLab(req('/rep-lab', { body: recording() }), deps)
    assert.equal(res.status, 201)
    const call = deps.calls.find(c => c.fn === 'watch_store_rep_lab')!
    assert.equal(call.args.p_user, USER)
    assert.equal((call.args.p_set as { logged_reps: number }).logged_reps, 10)
  })

  it('accepts a later correction without motion', async () => {
    const deps = fakeDeps({ watch_store_rep_lab: () => ({ data: { id: SET1, stored: true }, error: null }) })
    const res = await watchRepLab(req('/rep-lab', { body: { id: SET1, logged_reps: 11, corrected: true } }), deps)
    assert.equal(res.status, 201)
  })

  it('rejects mismatched axes, oversized windows and stray fields', async () => {
    for (const body of [
      recording({ y: motion(499) }),
      recording({ x: motion(939), y: motion(939), z: motion(939) }),
      recording({ password: 'x' }),
      { id: SET1, logged_reps: 11 },
    ]) {
      const res = await watchRepLab(req('/rep-lab', { body }), fakeDeps())
      assert.equal(res.status, 422)
      assert.equal((await errorOf(res)).code, 'validation_failed')
    }
  })

  it('a full 75 s window fits the body limit', async () => {
    const body = JSON.stringify(recording({ x: motion(938).map(v => v - 16000 + 16000), y: motion(938), z: motion(938), steps: new Array(938).fill(9999), events: Array.from({ length: 120 }, () => [99999, 3, 15, 1, 9999, 999]) }))
    assert.ok(Buffer.byteLength(body) < 64 * 1024, `${Buffer.byteLength(body)} bytes`)
  })

  const i16 = (vals: number[]) => {
    const b = Buffer.alloc(vals.length * 2)
    vals.forEach((v, i) => b.writeInt16BE(v, 2 * i))
    return b.toString('base64')
  }
  const tape = (n: number, overrides: Record<string, unknown> = {}) => {
    const { x: _x, y: _y, z: _z, steps: _s, ...meta } = recording()
    return {
      ...meta, enc: 'i16b64', ax: i16(motion(n)), ay: i16(motion(n)), az: i16(motion(n).map(v => 0 - v)),
      mx: i16(motion(n)), my: i16(motion(n)), mz: i16(motion(n)),
      hr: [90, 92, 95], beats: [650, 640, 655], step_marks: [[12, 0], [25, 2], [n, 5]],
      diag: { sensor: 'receiving', tape_total: n },
      ...overrides,
    }
  }

  it('decodes the tape format into the stored arrays', async () => {
    const deps = fakeDeps({ watch_store_rep_lab: () => ({ data: { id: SET1, stored: true }, error: null }) })
    const res = await watchRepLab(req('/rep-lab', { body: tape(40) }), deps)
    assert.equal(res.status, 201)
    const row = deps.calls.find(c => c.fn === 'watch_store_rep_lab')!.args.p_set as Record<string, unknown>
    assert.deepEqual(row.x, motion(40))
    assert.deepEqual(row.z, motion(40).map(v => 0 - v))
    assert.deepEqual(row.mag_x, motion(40))
    assert.deepEqual(row.hr, [90, 92, 95])
    assert.deepEqual(row.beats, [650, 640, 655])
    // Steps per sample from the window start: 0 until sample 12, then 2, then 5.
    const steps = row.steps as number[]
    assert.equal(steps.length, 40)
    assert.deepEqual([steps[0], steps[11], steps[12], steps[24], steps[25], steps[39]], [0, 0, 2, 2, 5, 5])
    assert.equal('ax' in row || 'enc' in row || 'step_marks' in row, false)
  })

  it('decodeI16 and stepsPerSample handle the edges', () => {
    assert.deepEqual(decodeI16(Buffer.from([0x7f, 0xff, 0x80, 0x00, 0xff, 0xff]).toString('base64')), [32767, -32768, -1])
    // A clipped window: marks count from START, the window from 10 samples in.
    assert.deepEqual(stepsPerSample([[5, 1], [15, 3], [20, 4]], 10, 20), [0, 0, 0, 0, 0, 1, 1, 1, 1, 1])
    assert.deepEqual(stepsPerSample([], 3, 3), [0, 0, 0])
  })

  it('a slimmed tape (no compass or beats) still stores, flagged', async () => {
    const deps = fakeDeps({ watch_store_rep_lab: () => ({ data: { id: SET1, stored: true }, error: null }) })
    const res = await watchRepLab(req('/rep-lab', { body: tape(30, { mx: undefined, my: undefined, mz: undefined, beats: undefined, slim: true }) }), deps)
    assert.equal(res.status, 201)
    const row = deps.calls.find(c => c.fn === 'watch_store_rep_lab')!.args.p_set as Record<string, unknown>
    assert.equal(row.mag_x, null)
    assert.equal((row.diag as { slim?: boolean }).slim, true)
  })

  it('rejects a malformed tape', async () => {
    for (const body of [
      tape(40, { ay: i16(motion(39)) }),
      tape(40, { mx: i16(motion(10)) }),
      tape(40, { ax: 'not base64!' }),
      tape(939, {}),
      tape(40, { enc: 'f32' }),
    ]) {
      const res = await watchRepLab(req('/rep-lab', { body }), fakeDeps())
      assert.equal(res.status, 422, JSON.stringify(body).slice(0, 80))
    }
  })

  it('a full tape with every extra fits the body limit', async () => {
    const body = JSON.stringify(tape(938, { hr: new Array(100).fill(200), beats: new Array(240).fill(4999), events: Array.from({ length: 120 }, () => [99999, 3, 15, 1, 9999, 999]), step_marks: Array.from({ length: 100 }, () => [99999, 9999]) }))
    assert.ok(Buffer.byteLength(body) < 32 * 1024, `${Buffer.byteLength(body)} bytes`)
  })

  it('maps an unknown session to 422 and a database failure to 503', async () => {
    const missing = fakeDeps({ watch_store_rep_lab: () => ({ data: null, error: { message: 'WATCH_SESSION_NOT_FOUND' } }) })
    const r1 = await watchRepLab(req('/rep-lab', { body: recording() }), missing)
    assert.equal(r1.status, 422)
    assert.equal((await errorOf(r1)).code, 'session_not_found')
    const down = fakeDeps({ watch_store_rep_lab: () => ({ data: null, error: { message: 'relation "rep_lab_sets" does not exist' } }) })
    const r2 = await watchRepLab(req('/rep-lab', { body: recording() }), down)
    assert.equal(r2.status, 503)
  })
})

describe('POST /readiness', () => {
  const RR = [930, 976, 998, 992, 1015, 994, 994, 989, 973, 965, 480, 924, 891, 881, 881, 898, 895, 897, 950, 946, 956, 987, 1020, 1015, 999, 1900, 2600, 966, 939, 936, 919, 915, 886, 879, 901, 909, 904, 947, 974, 988, 1450, 1020, 1014, 1020, 992, 984, 958, 949, 927, 902, 914, 888, 878, 889, 917, 250, 936, 959, 980, 986, 1006, 1011, 1011, 1004, 1004, 968, 943, 928, 922, 894]
  const body = (o: Record<string, unknown> = {}) => ({
    id: SET1, local_date: '2026-11-16', measured_at: '2026-11-16T11:30:00Z', duration_s: 60,
    rr_ms: RR, moving_s: 2, watch_rmssd: 20.4, app_version: '2026-11-18c', ...o,
  })

  it('recomputes HRV from the raw intervals and stores it', async () => {
    const deps = fakeDeps({ watch_store_readiness: () => ({ data: { id: SET1, stored: true }, error: null }) })
    const res = await watchReadiness(req('/readiness', { body: body({ watch_rmssd: 99 }) }), deps)
    assert.equal(res.status, 201)
    const out = (await res.json()) as { rmssd: number; quality: string; stored: boolean }
    assert.deepEqual([out.rmssd, out.quality, out.stored], [20.4, 'good', true])
    const row = deps.calls.find(c => c.fn === 'watch_store_readiness')!.args.p_check as Record<string, unknown>
    // The server's number wins; the watch's is kept only to compare.
    assert.deepEqual([row.rmssd, row.watch_rmssd, row.clean_beats, row.quality], [20.4, 99, 65, 'good'])
  })

  it('stores a poor reading as poor, with the reason in the reply', async () => {
    const deps = fakeDeps({ watch_store_readiness: () => ({ data: { id: SET1, stored: true }, error: null }) })
    const res = await watchReadiness(req('/readiness', { body: body({ moving_s: 30 }) }), deps)
    const out = (await res.json()) as { quality: string; reason: string }
    assert.deepEqual([out.quality, out.reason], ['poor', 'moving'])
  })

  it('rejects malformed checks and maps a database failure to 503', async () => {
    for (const b of [body({ rr_ms: [] }), body({ duration_s: 5 }), body({ local_date: '11/16' }), body({ extra: 1 }), body({ rr_ms: new Array(601).fill(900) })]) {
      assert.equal((await watchReadiness(req('/readiness', { body: b }), fakeDeps())).status, 422)
    }
    const down = fakeDeps({ watch_store_readiness: () => ({ data: null, error: { message: 'no function' } }) })
    assert.equal((await watchReadiness(req('/readiness', { body: body() }), down)).status, 503)
  })
})

describe('/today tuning and readiness', () => {
  const todayCtx = {
    local_date: '2026-11-16', is_rest_day: false, rotation: null, flex_days: [], last_completion: null,
    exercises: [
      { id: 'a', name: 'Bench', day_type: 'push', active: true, sets_target: 3, reps_target: '8', weight_target: 135, rest_seconds: 90, sort_order: 0, last_weight: null },
      { id: 'b', name: 'Fly', day_type: 'push', active: true, sets_target: 3, reps_target: '12', weight_target: 25, rest_seconds: 60, sort_order: 1, last_weight: null },
    ],
  }

  it('sends each exercise its tuned counter settings, valid ones only', async () => {
    const res = await watchToday(req('/today'), fakeDeps({
      watch_today_context: () => ({ data: todayCtx, error: null }),
      watch_rep_tuning: args => {
        assert.equal(typeof args.p_algo, 'string')
        return { data: [{ exercise_id: 'a', params: { lag: 7, ac: 0.55, bogus: 3 } }, { exercise_id: 'b', params: { ac: 9 } }], error: null }
      },
      watch_body_context: () => ({ data: { days: [], sessions: [], prefs: null }, error: null }),
    }))
    const p = (await res.json()) as { workout: { exercises: { id: string; tune?: Record<string, number> }[] } }
    assert.deepEqual(p.workout.exercises[0].tune, { ac: 0.55, lag: 7 })
    assert.equal(p.workout.exercises[1].tune, undefined)
  })

  it('a failed tuning read leaves /today untouched', async () => {
    const res = await watchToday(req('/today'), fakeDeps({
      watch_today_context: () => ({ data: todayCtx, error: null }),
      watch_rep_tuning: () => ({ data: null, error: { message: 'missing function' } }),
      watch_body_context: () => ({ data: { days: [], sessions: [], prefs: null }, error: null }),
    }))
    assert.equal(res.status, 200)
    const p = (await res.json()) as { workout: { exercises: { tune?: unknown }[] } }
    assert.equal(p.workout.exercises.some(e => e.tune), false)
  })

  it('body carries the HRV range and lifting advice for the watch', () => {
    const day = (i: number) => {
      const d = new Date('2026-11-16T12:00:00'); d.setDate(d.getDate() - i)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    }
    const readiness = Array.from({ length: 8 }, (_, i) => ({ local_date: day(i + 1), measured_at: `${day(i + 1)}T06:30:00Z`, rmssd: 55 + (i % 3) * 3, ln_rmssd: Math.log(55 + (i % 3) * 3), mean_hr: 52, quality: 'good' as const }))
    const b = todayBody({ days: [], sessions: [], readiness, strength: [], prefs: null }, '2026-11-16')
    assert.ok(b.hrv && b.hrv.low < 55 && b.hrv.high > 58 && b.hrv.days === 8 && b.hrv.today === null)
    assert.equal(b.lift, null)
    assert.equal(todayBody({ days: [], sessions: [], prefs: null }, '2026-11-16').hrv, null)
  })
})
