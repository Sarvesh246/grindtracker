import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sleepSpan } from '../model'

describe('sleepSpan', () => {
  it('keeps a sleep that ends after noon on one continuous timeline', () => {
    // 23:00 -> 12:00 next day is 13h: bed folds to -60, wake must land at +720, not -720.
    const s = sleepSpan({
      start_at: '2026-11-20T23:00:00Z',
      end_at: '2026-11-21T12:00:00Z',
      timezone: 'UTC'
    })
    assert.equal(s.bed, -60)
    assert.equal(s.wake, 720)
  })

  it('matches the plain clock for an ordinary night', () => {
    const s = sleepSpan({
      start_at: '2026-11-20T23:30:00Z',
      end_at: '2026-11-21T07:00:00Z',
      timezone: 'UTC'
    })
    assert.equal(s.bed, -30)
    assert.equal(s.wake, 420)
  })
})
