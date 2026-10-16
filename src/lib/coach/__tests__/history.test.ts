import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCoachTurns, unansweredUserTurns } from '../history'

describe('normalizeCoachTurns', () => {
  it('merges an unanswered user turn into the new message', () => {
    const out = normalizeCoachTurns([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
      { role: 'user', content: 'Mon: Upper A …' },
      { role: 'user', content: 'How was that workout?' },
    ])
    assert.deepEqual(out, [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hey' },
      { role: 'user', content: 'Mon: Upper A …\n\nHow was that workout?' },
    ])
  })

  it('drops a leading assistant turn and blank turns', () => {
    const out = normalizeCoachTurns([
      { role: 'assistant', content: 'tail of an old reply' },
      { role: 'user', content: '  ' },
      { role: 'user', content: 'bench?' },
    ])
    assert.deepEqual(out, [{ role: 'user', content: 'bench?' }])
  })

  it('does not mutate its input', () => {
    const input = [
      { role: 'user' as const, content: 'a' },
      { role: 'user' as const, content: 'b' },
    ]
    normalizeCoachTurns(input)
    assert.equal(input[0].content, 'a')
  })
})

describe('unansweredUserTurns', () => {
  it('returns user turns after the last assistant reply', () => {
    assert.deepEqual(
      unansweredUserTurns([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'user', content: 'd' },
      ]),
      ['c', 'd'],
    )
  })

  it('is empty when the history ends on a reply', () => {
    assert.deepEqual(
      unansweredUserTurns([
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ]),
      [],
    )
  })
})
