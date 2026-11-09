import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildCoachContext } from '../buildContext'

type Result = { data: unknown; error: { message: string } | null; count?: number }

/** Chainable, awaitable stand-in for a PostgREST builder. */
function chain(result: Result) {
  const builder: Record<string, unknown> = {}
  const self = new Proxy(builder, {
    get(_t, prop) {
      if (prop === 'then') {
        return (resolve: (v: Result) => unknown) => Promise.resolve(result).then(resolve)
      }
      return () => self
    },
  })
  return self
}

function fakeClient(failing: string | null) {
  const ok: Result = { data: null, error: null }
  const rows: Record<string, Result> = {
    exercises: { data: [], error: null },
    sessions: { data: [], error: null },
    user_rest_days: { data: [], error: null },
    user_rest_dates: { data: [], error: null },
    user_flex_days: { data: [], error: null },
    user_day_categories: { data: [], error: null },
    body_weights: { data: [], error: null },
  }
  return {
    from(table: string) {
      if (table === failing) {
        return chain({ data: null, error: { message: `${table} read dropped` } })
      }
      return chain(rows[table] ?? ok)
    },
    rpc: () => chain(ok),
  }
}

const OPTS = { asOfLocalDate: '2026-11-09' }

describe('buildCoachContext read failures', () => {
  it('rejects when the exercises read errors instead of reporting no days', async () => {
    await assert.rejects(
      buildCoachContext(fakeClient('exercises') as never, 'u1', 'lbs', OPTS),
      /Coach context read failed \(exercises\)/,
    )
  })

  it('rejects when the user_stats read errors', async () => {
    await assert.rejects(
      buildCoachContext(fakeClient('user_stats') as never, 'u1', 'lbs', OPTS),
      /Coach context read failed \(user_stats\)/,
    )
  })
})
