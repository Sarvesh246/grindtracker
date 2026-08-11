import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { queueOp, getQueuedOps, removeQueuedOp, type QueuedOp } from '../offlineQueue'

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
})
