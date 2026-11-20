import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBodySummary } from '../queries'

type Result = { data: unknown; error: { code?: string; message: string } | null }

/** A chainable stand-in for the Supabase query builder: every filter returns
 *  the same builder, and awaiting it yields the result set for that table. */
function fakeClient(results: Record<string, Result>): SupabaseClient {
  const builder = (table: string): unknown => {
    const result = results[table] ?? { data: [], error: null }
    const proxy: unknown = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then') return (resolve: (v: Result) => unknown) => resolve(result)
          return () => proxy
        },
      },
    )
    return proxy
  }
  return { from: (table: string) => builder(table) } as unknown as SupabaseClient
}

const TODAY = '2026-11-19'

describe('body summary keeps failed reads apart from empty ones', () => {
  it('flags a failed readiness read instead of reporting no checks', async () => {
    const s = await getBodySummary(
      fakeClient({ readiness_checks: { data: null, error: { code: '500', message: 'boom' } } }),
      'u1',
      TODAY,
    )
    assert.equal(s.available, true)
    assert.equal(s.readinessError, true)
    assert.deepEqual(s.readinessChecks, [])
  })

  it('treats an absent readiness table (migration 68 not applied) as none, not as a failure', async () => {
    const s = await getBodySummary(
      fakeClient({ readiness_checks: { data: null, error: { code: '42P01', message: 'missing' } } }),
      'u1',
      TODAY,
    )
    assert.equal(s.readinessError, false)
    assert.deepEqual(s.readinessChecks, [])
  })

  it('flags a failed signal-label read so tags cannot overwrite a saved set', async () => {
    const s = await getBodySummary(
      fakeClient({ body_signal_labels: { data: null, error: { code: '500', message: 'boom' } } }),
      'u1',
      TODAY,
    )
    assert.equal(s.labelsError, true)
    assert.equal(s.readinessError, false)
  })

  it('reads a successful empty label set as no error', async () => {
    const s = await getBodySummary(fakeClient({ body_signal_labels: { data: [], error: null } }), 'u1', TODAY)
    assert.equal(s.labelsError, false)
  })
})
