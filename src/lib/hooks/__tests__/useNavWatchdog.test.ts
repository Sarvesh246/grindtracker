import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldHardNavigate } from '../useNavWatchdog'

describe('shouldHardNavigate', () => {
  it('is false when we are already on the target path', () => {
    assert.equal(shouldHardNavigate('/home', '/home'), false)
    assert.equal(shouldHardNavigate('/log', '/log?day=push'), false)
  })

  it('is true when the target is a different path', () => {
    assert.equal(shouldHardNavigate('/home', '/profile'), true)
    assert.equal(shouldHardNavigate('/leaderboard/sam', '/leaderboard'), true)
  })
})
