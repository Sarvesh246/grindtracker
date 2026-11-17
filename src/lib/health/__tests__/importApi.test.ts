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
  it('accepts one "start | end | value" line per sample, the easiest thing for a Shortcut to build', () => {
    const text = rows.map((r) => `${r.start} | ${r.end} | ${r.value}`).join('\n')
    assert.deepEqual(normalizeSamples(text), rows)
    assert.deepEqual(
      normalizeSamples(rows.map((r) => `${r.start},${r.end},${r.value}`).join('\n')),
      rows
    )
    assert.deepEqual(normalizeSamples('\n' + text + '\n\n'), rows)
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

describe('simulating the real Shortcut', () => {
  // A realistic 3-day Apple Health pull: two writers (watch + phone), In Bed rows,
  // minute-level stage fragments, CRLF line endings, and a trailing blank line.
  function pull(days = 3, fragmentMinutes = 5) {
    const rows: string[] = []
    for (let d = days; d >= 1; d--) {
      const end = Date.parse('2026-11-17T13:00:00Z') - (d - 1) * 86400000
      const start = end - 8 * 3600000
      rows.push(`${new Date(start - 600000).toISOString().replace('Z', '+00:00')} | ${new Date(end + 300000).toISOString().replace('Z', '+00:00')} | In Bed`)
      const stages = ['Core', 'Deep', 'Core', 'REM', 'Asleep (Core)', 'Awake']
      for (let t = start, i = 0; t < end; t += fragmentMinutes * 60000, i++) {
        const row = `${new Date(t).toISOString().replace('Z', '+00:00')} | ${new Date(t + fragmentMinutes * 60000).toISOString().replace('Z', '+00:00')} | ${stages[Math.floor(i / 6) % stages.length]}`
        rows.push(row)
        if (i % 7 === 0) rows.push(row) // a second app wrote the same sample
      }
    }
    return rows.join('\r\n') + '\r\n\r\n'
  }
  const send = (samples: string, over: Record<string, unknown> = {}, token: string | null = null) => {
    const { d, calls } = deps()
    return healthImportRequest(
      post({ kind: 'apple_health', timezone: 'America/Chicago', token: TOKEN, samples, ...over }, token),
      d
    ).then(async (res) => ({ res, body: (await res.json()) as Record<string, unknown>, calls }))
  }
  it('saves all three nights from a messy realistic pull', async () => {
    const { res, body, calls } = await send(pull())
    assert.equal(res.status, 200)
    assert.equal(body.imported, 3)
    const batch = calls.find((c) => c.fn === 'token_import_health_batch')!.args.p_batch as { sleeps: { kind: string; stage_totals: unknown }[] }
    assert.equal(batch.sleeps.length, 3)
    assert.ok(batch.sleeps.every((s) => s.kind === 'main' && s.stage_totals))
  })
  it('survives a night with thousands of fragments by keeping totals and dropping the timeline', async () => {
    const { res, body, calls } = await send(pull(1, 1))
    assert.equal(res.status, 200)
    assert.equal(body.imported, 1)
    const batch = calls.find((c) => c.fn === 'token_import_health_batch')!.args.p_batch as { sleeps: { stages: unknown[] | null }[] }
    assert.ok(batch.sleeps[0].stages === null || batch.sleeps[0].stages.length <= 1500)
  })
  it('works with local times that carry no offset', async () => {
    const naive = [
      '2026-11-16T23:30:00 | 2026-11-17T02:00:00 | Core',
      '2026-11-17T02:00:00 | 2026-11-17T03:00:00 | Deep',
      '2026-11-17T03:00:00 | 2026-11-17T07:15:00 | Asleep (REM)'
    ].join('\n')
    const { body } = await send(naive)
    assert.equal(body.imported, 1)
  })
  it('explains a missing database function instead of a vague retry', async () => {
    const { d } = deps({
      token_import_health_batch: {
        data: null,
        error: { message: 'Could not find the function public.token_import_health_batch(p_batch, p_device, p_source, p_user) in the schema cache' }
      }
    })
    const res = await healthImportRequest(post({ ...apple, token: TOKEN }, null), d)
    const body = (await res.json()) as { error: { code: string; message: string } }
    assert.equal(body.error.code, 'setup_required')
    assert.match(body.error.message, /migration 64/)
  })
  it('keeps the old vague error for genuine, unrelated failures', async () => {
    const { d } = deps({ token_import_health_batch: { data: null, error: { message: 'deadlock detected' } } })
    const res = await healthImportRequest(post({ ...apple, token: TOKEN }, null), d)
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'service_unavailable')
  })
})
