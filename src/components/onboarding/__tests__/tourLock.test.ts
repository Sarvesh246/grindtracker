import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  claimTour,
  getRunningTourId,
  releaseTour,
  resetTourLockForTests,
} from '../tourLock'

describe('tourLock', () => {
  beforeEach(() => {
    resetTourLockForTests()
  })

  it('lets the first tour claim the slot', () => {
    assert.equal(claimTour('home'), true)
    assert.equal(getRunningTourId(), 'home')
  })

  it('rejects a second tour while another owns the slot', () => {
    assert.equal(claimTour('home'), true)
    assert.equal(claimTour('coach'), false)
    assert.equal(getRunningTourId(), 'home')
  })

  it('is idempotent for the owner', () => {
    assert.equal(claimTour('home'), true)
    assert.equal(claimTour('home'), true)
    assert.equal(getRunningTourId(), 'home')
  })

  it('frees the slot on release so the waiter can claim', () => {
    assert.equal(claimTour('home'), true)
    releaseTour('home')
    assert.equal(getRunningTourId(), null)
    assert.equal(claimTour('coach'), true)
    assert.equal(getRunningTourId(), 'coach')
  })

  it('ignores release from a tour that does not own the slot', () => {
    assert.equal(claimTour('home'), true)
    releaseTour('coach')
    assert.equal(getRunningTourId(), 'home')
  })
})
