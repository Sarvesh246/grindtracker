import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatSetsReps } from '../formatting'

describe('formatSetsReps', () => {
  it('adds reps only to numeric targets', () => {
    assert.equal(formatSetsReps(3, 10), '3 sets × 10 reps')
    assert.equal(formatSetsReps(3, '10-12'), '3 sets × 10-12 reps')
    assert.equal(formatSetsReps(3, '15-20 each'), '3 sets × 15-20 each')
    assert.equal(formatSetsReps(3, '45-60 sec'), '3 sets × 45-60 sec')
  })
})
