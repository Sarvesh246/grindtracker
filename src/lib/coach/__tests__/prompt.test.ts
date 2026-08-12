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

  it('locks terminology, verified math, and data-driven tone', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Strict fitness\/anatomical terminology/i)
    assert.match(COACH_SYSTEM_PROMPT, /deadlifts, not "deadlocks"/i)
    assert.match(COACH_SYSTEM_PROMPT, /work step-by-step/i)
    assert.match(COACH_SYSTEM_PROMPT, /verify before stating/i)
    assert.match(COACH_SYSTEM_PROMPT, /data-driven coach/i)
    assert.match(COACH_SYSTEM_PROMPT, /never generic motivational clich/i)
  })

  it('requires general answers to also use personal training_history', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Always pair general fitness knowledge/i)
    assert.match(COACH_SYSTEM_PROMPT, /training_history/i)
    assert.match(COACH_SYSTEM_PROMPT, /significant_breaks/i)
    assert.match(COACH_SYSTEM_PROMPT, /how long until muscle growth/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Do not answer a general fitness question with only textbook timelines/i,
    )
  })
})
