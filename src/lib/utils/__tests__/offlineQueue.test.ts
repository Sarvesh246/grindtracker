import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  queueOp,
  getQueuedOps,
  removeQueuedOp,
  flushQueuedOps,
  isTransientError,
  remapQueuedSession,
  withRequestTimeout,
  type QueuedOp,
} from '../offlineQueue'
import {
  clearPendingLocalSession,
  ensurePendingLocalSession,
  getPendingLocalSessions,
  readWorkoutSnapshot,
  recordSessionAlias,
  saveWorkoutSnapshot,
} from '../../offline/localSession'

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
      // A batch containing the bad row is refused whole; sent alone the good
      // row goes through — the flush must isolate the offender.
      const supabase = {
        from: () => ({
          upsert: async (rows: { set_number: number } | { set_number: number }[]) =>
            (Array.isArray(rows) ? rows : [rows]).some(r => r.set_number === 1)
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

describe('offlineQueue — gentle sync', () => {
  it('sends every queued upsert as one bulk request', async () => {
    for (let n = 1; n <= 5; n++) queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: n, queuedAt: n }))
    let calls = 0
    const supabase = {
      from: () => ({
        upsert: async (rows: unknown) => {
          calls++
          assert.ok(Array.isArray(rows) && rows.length === 5)
          return { error: null }
        },
      }),
    }
    const { synced } = await flushQueuedOps('s1', supabase as never)
    assert.equal(calls, 1)
    assert.equal(synced.length, 5)
    assert.equal(getQueuedOps('s1').length, 0)
  })

  it('stops after the first transient failure instead of probing a dead link', async () => {
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1, queuedAt: 1 }))
    queueOp({ kind: 'delete', sessionId: 's1', exerciseId: 'e2', setNumber: 1, queuedAt: 2 })
    let calls = 0
    const supabase = {
      from: () => {
        calls++
        return { upsert: async () => ({ error: { message: 'Failed to fetch', code: '' } }) }
      },
    }
    await flushQueuedOps('s1', supabase as never)
    assert.equal(calls, 1)
    assert.equal(getQueuedOps('s1').length, 2)
  })

  it('shares one in-flight flush between concurrent callers', async () => {
    queueOp(upsert({ sessionId: 's1', exerciseId: 'e1', setNumber: 1 }))
    let calls = 0
    const supabase = {
      from: () => ({
        upsert: async () => {
          calls++
          await new Promise(r => setTimeout(r, 10))
          return { error: null }
        },
      }),
    }
    await Promise.all([
      flushQueuedOps('s1', supabase as never),
      flushQueuedOps('s1', supabase as never),
      flushQueuedOps('s1', supabase as never),
    ])
    assert.equal(calls, 1)
  })

  it('treats a hung request as a transient failure', async () => {
    const hung = new Promise<{ error: null }>(() => {})
    const result = await withRequestTimeout(hung, 20)
    assert.equal(isTransientError(result.error), true)
  })
})

describe('local sessions', () => {
  it('remaps queued ops onto the server session and keeps the old id resolving', () => {
    queueOp(upsert({ sessionId: 'local', exerciseId: 'e1', setNumber: 1 }))
    recordSessionAlias('local', 'server')
    remapQueuedSession('local', 'server')
    assert.equal(getQueuedOps('server').length, 1)
    // A handler still holding the old id lands on the real session.
    queueOp(upsert({ sessionId: 'local', exerciseId: 'e1', setNumber: 2 }))
    assert.equal(getQueuedOps('server').length, 2)
    assert.equal(getQueuedOps('local').length, 2)
  })

  it('mints one pending session per day and reuses it', () => {
    const a = ensurePendingLocalSession('push', 'u1')
    const b = ensurePendingLocalSession('push', 'u1')
    const c = ensurePendingLocalSession('legs', 'u1')
    assert.equal(a.id, b.id)
    assert.notEqual(a.id, c.id)
    assert.equal(getPendingLocalSessions().length, 2)
    clearPendingLocalSession(a.id)
    assert.equal(getPendingLocalSessions().length, 1)
  })

  it('round-trips the workout snapshot and scopes it to a user', () => {
    saveWorkoutSnapshot('u1', [{ id: 'e1' }], { e1: 100 }, { e1: 800 })
    saveWorkoutSnapshot('u1', [{ id: 'e1' }, { id: 'e2' }], { e2: 50 }, {})
    const snap = readWorkoutSnapshot<{ id: string }>('u1')
    assert.equal(snap?.exercises.length, 2)
    assert.deepEqual(snap?.bests, { e1: 100, e2: 50 })
    assert.equal(readWorkoutSnapshot('someone-else'), null)
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
