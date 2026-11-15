import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { withDeadline } from '../deadline'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('withDeadline', () => {
  it('returns the work result when it finishes in time', async () => {
    assert.equal(await withDeadline(Promise.resolve('ok'), 200, 'late'), 'ok')
  })

  it('returns the fallback when the work is too slow', async () => {
    const started = Date.now()
    const result = await withDeadline(sleep(2_000).then(() => 'ok'), 30, 'late')
    assert.equal(result, 'late')
    assert.ok(Date.now() - started < 1_000, 'must not wait for the slow work')
  })

  it('propagates a rejection from the work', async () => {
    await assert.rejects(withDeadline(Promise.reject(new Error('boom')), 200, 'late'), /boom/)
  })
})
