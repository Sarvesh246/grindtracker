import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { queueOp, getQueuedOps, removeQueuedOp, flushQueuedOps, isTransientError, type QueuedOp } from '../offlineQueue'

// Minimal localStorage for Node tests
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  // @ts-expect-error test stub
  globalThis.window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    },
  }
})

function upsert(partial: Partial<QueuedOp> & { sessionId: string; exerciseId: string; setNumber: number }): QueuedOp {
  return {
    kind: 'upsert',
    weight: 100,
    reps: 8,
    isPR: true,
    isWarmup: false,
    note: null,
    isSkipped: false,
    rpe: 8,
    queuedAt: Date.now(),
    ...partial,
  } as QueuedOp
}

describe('offlineQueue', () => {
  it('queues and returns ops for a session', () => {
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1 }))
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 2 }))
    queueOp(upsert({ sessionId: 's2', exerciseId: 'e1', setNumber: 1 }))
    assert.equal(getQueuedOps('s1').length, 2)
    assert.equal(getQueuedOps('s2').length, 1)
  })

  it('keeps only the latest op per slot', () => {
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1, weight: 100, queuedAt: 1 }))
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1, weight: 110, queuedAt: 2 }))
    const ops = getQueuedOps('s1')
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind === 'upsert' ? ops[0].weight : null, 110)
  })

  it('removes a queued slot', () => {
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1 }))
    removeQueuedOp('s1', 'e1', 1)
    assert.equal(getQueuedOps('s1').length, 0)
  })

  it('flush does not drop a newer op queued during sync', async () => {
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1, weight: 100, queuedAt: 1 }))
    const supabase = {
      from() {
        return {
          upsert: async () => {
            queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1, weight: 120, queuedAt: 2 }))
            return { error: null }
          },
        }
      },
    }
    const { synced } = await flushQueuedOps('s1', supabase as never)
    assert.equal(synced.length, 0)
    const ops = getQueuedOps('s1')
    assert.equal(ops.length, 1)
    assert.equal(ops[0].kind === 'upsert' ? ops[0].weight : null, 120)
  })

  it('flush keeps a transient failure queued', async () => {
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1 }))
    const supabase = {
      from: () => ({ upsert: async () => ({ error: { message: 'Failed to fetch', code: '' } }) }),
    }
    const { synced, rejected } = await flushQueuedOps('s1', supabase as never)
    assert.equal(synced.length, 0)
    assert.equal(rejected.length, 0)
    assert.equal(getQueuedOps('s1').length, 1)
  })

  it('flush drops a permanent failure and returns it as rejected', async () => {
    const realFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('{}')) as typeof fetch
    try {
      queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1 }))
      queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 2 }))
      const supabase = {
        from: () => ({
          upsert: async (row: { set_number: number }) =>
            row.set_number === 1
              ? { error: { message: 'violates check constraint', code: '23514' } }
              : { error: null },
        }),
      }
      const { synced, rejected } = await flushQueuedOps('s1', supabase as never)
      assert.deepEqual(rejected, [{ exerciseId: 'e1', setNumber: 1 }])
      assert.deepEqual(synced, [{ exerciseId: 'e1', setNumber: 2 }])
      assert.equal(getQueuedOps('s1').length, 0)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})

describe('isTransientError', () => {
  it('treats network failures as transient', () => {
    assert.equal(isTransientError(new TypeError('Failed to fetch')), true)
    assert.equal(isTransientError({ name: 'AbortError', message: 'aborted' }), true)
    assert.equal(isTransientError({ message: 'Failed to fetch', code: '' }), true)
    assert.equal(isTransientError({ message: 'no code' }), true)
  })

  it('treats retryable HTTP statuses as transient', () => {
    assert.equal(isTransientError({ code: 'X', status: 503 }), true)
    assert.equal(isTransientError({ code: 'X', status: 429 }), true)
    assert.equal(isTransientError({ code: 'X', status: 408 }), true)
  })

  it('treats an expired JWT as transient', () => {
    assert.equal(isTransientError({ code: 'PGRST301', message: 'JWT expired' }), true)
    assert.equal(isTransientError({ code: 'PGRST303', message: 'x' }), true)
  })

  it('treats Postgres and PostgREST rejections as permanent', () => {
    for (const code of ['23514', '23503', '42501', 'P0001', 'PGRST116', 'PGRST204']) {
      assert.equal(isTransientError({ code, message: 'nope' }), false, code)
    }
  })
})
