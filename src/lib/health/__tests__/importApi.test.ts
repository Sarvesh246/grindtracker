import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { healthImportRequest, normalizeSamples } from '../importApi'
import type { RpcResult, WatchDeps } from '@/lib/watch/handlers'

const TOKEN = `gwt_${'a'.repeat(64)}`
const NOW = new Date('2026-11-17T15:00:00Z')

function deps(over: Partial<Record<string, RpcResult>> = {}) {
  const calls: { fn: string; args: Record<string, unknown> }[] = []
  const d: WatchDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args })
      return (
        over[fn] ??
        (fn === 'watch_authenticate'
          ? {
              data: { status: 'ok', user_id: 'u1', device_id: 'd1', device: 'Shortcut' },
              error: null
            }
          : { data: { acknowledged: 'x' }, error: null })
      )
    },
    afterCompletion: async () => {},
    now: () => NOW,
    log: () => {}
  }
  return { d, calls }
}
const post = (body: unknown, token: string | null = TOKEN) =>
  new Request('https://grind.test/api/watch/v1/health-import', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  })
const apple = {
  kind: 'apple_health',
  timezone: 'America/Chicago',
  samples: [
    { start: '2026-11-15T23:40:00-06:00', end: '2026-11-16T03:30:00-06:00', value: 'Core' },
    { start: '2026-11-16T03:30:00-06:00', end: '2026-11-16T07:24:00-06:00', value: 'REM' }
  ]
}

describe('samples flattened to text by Shortcuts', () => {
  const rows = apple.samples
  it('accepts a JSON array string', () => {
    assert.equal(normalizeSamples(JSON.stringify(rows))?.length, 2)
  })
  it('accepts back-to-back pretty-printed objects, with or without commas', () => {
    const block = (r: (typeof rows)[number]) =>
      `{\n  "start" : "${r.start}",\n  "end" : "${r.end}",\n  "value" : "${r.value}"\n}`
    assert.equal(normalizeSamples(rows.map(block).join('\n'))?.length, 2)
    assert.equal(normalizeSamples(rows.map(block).join(',\n'))?.length, 2)
  })
  it('accepts loose key: value text in order', () => {
    const text = rows.map((r) => `start: ${r.start}\nend: ${r.end}\nvalue: ${r.value}`).join('\n\n')
    assert.deepEqual(normalizeSamples(text), rows)
  })
  it('refuses text it cannot read instead of guessing', () => {
    assert.equal(normalizeSamples('hello world'), null)
    assert.equal(normalizeSamples([{ start: 'x' }]), null)
    assert.equal(normalizeSamples(''), null)
  })
  it('the endpoint saves a night sent as text and 422s on unreadable text', async () => {
    const { d, calls } = deps()
    const ok = await healthImportRequest(
      post({ ...apple, samples: JSON.stringify(apple.samples) }),
      d
    )
    assert.equal(ok.status, 200)
    assert.equal(calls.filter((c) => c.fn === 'token_import_health_batch').length, 1)
    const bad = await healthImportRequest(post({ ...apple, samples: 'garbage' }), d)
    assert.equal(bad.status, 422)
  })
})

describe('POST /health-import token in the body', () => {
  it('accepts the token in the JSON body when the Authorization header is missing', async () => {
    const { d, calls } = deps()
    const res = await healthImportRequest(post({ ...apple, token: TOKEN }, null), d)
    assert.equal(res.status, 200)
    assert.equal(calls.find((c) => c.fn === 'token_import_health_batch')!.args.p_user, 'u1')
    assert.ok(
      !JSON.stringify(calls.find((c) => c.fn === 'token_import_health_batch')!.args).includes(TOKEN)
    )
  })
  it('still demands a token when neither the header nor the body has one', async () => {
    const { d } = deps()
    const res = await healthImportRequest(post(apple, null), d)
    assert.equal(res.status, 401)
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'missing_token')
  })
  it('rejects a malformed body token without a database lookup', async () => {
    const { d, calls } = deps()
    const res = await healthImportRequest(post({ ...apple, token: 'nope' }, null), d)
    assert.equal(res.status, 401)
    assert.equal(calls.length, 0)
  })
})

describe('POST /health-import', () => {
  it('needs a device token', async () => {
    const { d } = deps()
    assert.equal((await healthImportRequest(post(apple, null), d)).status, 401)
  })
  it('turns Apple Health samples into a validated apple_health batch for that user and device', async () => {
    const { d, calls } = deps()
    const res = await healthImportRequest(post(apple), d)
    assert.equal(res.status, 200)
    const body = (await res.json()) as {
      imported: number
      nights: { wake_date: string; minutes: number }[]
    }
    assert.equal(body.imported, 1)
    assert.equal(body.nights[0].wake_date, '2026-11-16')
    const call = calls.find((c) => c.fn === 'token_import_health_batch')!
    assert.equal(call.args.p_user, 'u1')
    assert.equal(call.args.p_device, 'd1')
    assert.equal(call.args.p_source, 'apple_health')
  })
  it('accepts raw Garmin Connect responses from the sync script', async () => {
    const { d, calls } = deps()
    const night = {
      dailySleepDTO: {
        calendarDate: '2026-11-16',
        sleepTimeSeconds: 26280,
        sleepStartTimestampGMT: Date.parse('2026-11-16T05:24:00Z'),
        sleepEndTimestampGMT: Date.parse('2026-11-16T13:24:00Z'),
        deepSleepSeconds: 5400,
        lightSleepSeconds: 14400,
        remSleepSeconds: 6480,
        awakeSleepSeconds: 2520
      },
      avgOvernightHrv: 48
    }
    const res = await healthImportRequest(
      post({ kind: 'garmin_api', days: [night, { nonsense: true }] }),
      d
    )
    const body = (await res.json()) as { imported: number; skipped: { reason: string }[] }
    assert.equal(body.imported, 1)
    assert.equal(body.skipped[0].reason, 'No sleep start/end time')
    assert.equal(
      calls.find((c) => c.fn === 'token_import_health_batch')!.args.p_source,
      'garmin_unofficial'
    )
  })
  it('rejects unknown shapes with a 422 and never calls the database importer', async () => {
    const { d, calls } = deps()
    const res = await healthImportRequest(post({ kind: 'steps', samples: [] }), d)
    assert.equal(res.status, 422)
    assert.equal(
      calls.some((c) => c.fn === 'token_import_health_batch'),
      false
    )
  })
  it('tells the caller when collection is paused instead of pretending it saved', async () => {
    const { d } = deps({
      token_import_health_batch: { data: null, error: { message: 'HEALTH_COLLECTION_PAUSED' } }
    })
    const res = await healthImportRequest(post(apple), d)
    assert.equal(res.status, 409)
    assert.equal(
      ((await res.json()) as { error: { code: string } }).error.code,
      'collection_paused'
    )
  })
  it('hides database errors behind a retryable 503', async () => {
    const { d } = deps({
      token_import_health_batch: { data: null, error: { message: 'relation x does not exist' } }
    })
    const res = await healthImportRequest(post(apple), d)
    assert.equal(res.status, 503)
    assert.doesNotMatch(await res.text(), /relation/)
  })
})
