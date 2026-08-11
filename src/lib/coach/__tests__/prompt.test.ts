import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COACH_SYSTEM_PROMPT } from '../prompt'

describe('COACH_SYSTEM_PROMPT', () => {
  it('requires skimmable formatting on every reply, not only chips', () => {
    assert.match(COACH_SYSTEM_PROMPT, /EVERY reply/i)
    assert.match(COACH_SYSTEM_PROMPT, /typed questions and starter chips/i)
    assert.match(COACH_SYSTEM_PROMPT, /"- "/)
  })

  it('covers freeform question shapes beyond the starter chips', () => {
    // Chips cover streak / PRs / last workout / progressing — prompt must
    // also steer body weight, schedule, advice, and thin-data answers.
    for (const shape of [
      'Body weight',
      'Next day / rotation',
      'Advice',
      'Missing / thin data',
      'Last workout',
      'PRs',
      'Streak',
    ]) {
      assert.match(
        COACH_SYSTEM_PROMPT,
        new RegExp(shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        `missing shape guidance for ${shape}`,
      )
    }
  })
})
