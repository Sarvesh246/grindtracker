import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sameFinishUndoToken, type FinishUndoToken } from '../finishUndo'

function token(over: Partial<FinishUndoToken> = {}): FinishUndoToken {
  return {
    sessionId: 'sess-1',
    day: 'push',
    userId: 'user-1',
    xpEarned: 100,
    prevRotationIndex: 0,
    expiresAt: 1_700_000_000_000,
    ...over,
  }
}

describe('sameFinishUndoToken', () => {
  it('is true for identical content even when object identity differs', () => {
    assert.equal(sameFinishUndoToken(token(), token()), true)
  })

  it('is false when the session changes', () => {
    assert.equal(sameFinishUndoToken(token(), token({ sessionId: 'sess-2' })), false)
  })

  it('treats null as only equal to null', () => {
    assert.equal(sameFinishUndoToken(null, null), true)
    assert.equal(sameFinishUndoToken(token(), null), false)
  })
})
