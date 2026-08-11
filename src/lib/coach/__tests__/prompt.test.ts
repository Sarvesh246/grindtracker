import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COACH_SYSTEM_PROMPT } from '../prompt'

describe('COACH_SYSTEM_PROMPT', () => {
  it('requires adaptive formatting on every reply, not only chips', () => {
    assert.match(COACH_SYSTEM_PROMPT, /EVERY reply/i)
    assert.match(COACH_SYSTEM_PROMPT, /typed questions and starter chips/i)
    assert.match(COACH_SYSTEM_PROMPT, /Pick the structure that best fits/i)
    assert.match(COACH_SYSTEM_PROMPT, /Do not force the same template/i)
  })

  it('defines distinct structures for different question intents', () => {
    for (const shape of [
      'Stats / progress / PRs',
      'Technique / how-to',
      'NUMBERED list',
      'Simple fact',
      'Explanation',
      'Multi-topic',
      'Coaching advice',
      'Missing / thin data',
    ]) {
      assert.match(
        COACH_SYSTEM_PROMPT,
        new RegExp(shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        `missing shape guidance for ${shape}`,
      )
    }
  })

  it('forbids collapsing every answer into identical bullets', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Do not turn every answer into lead/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Do not use unordered bullets for a sequence/i,
    )
  })
})
