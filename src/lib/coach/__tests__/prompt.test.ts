import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COACH_SYSTEM_PROMPT } from '../prompt'

describe('COACH_SYSTEM_PROMPT', () => {
  it('requires adaptive formatting on every reply, not only chips', () => {
    assert.match(COACH_SYSTEM_PROMPT, /EVERY reply/i)
    assert.match(COACH_SYSTEM_PROMPT, /typed questions and starter chips/i)
    assert.match(COACH_SYSTEM_PROMPT, /Pick the format that fits THIS ask/i)
    assert.match(COACH_SYSTEM_PROMPT, /Never reuse one template/i)
  })

  it('defines distinct structures for different question intents', () => {
    for (const shape of [
      'Simple fact',
      'Stats / progress / PRs',
      'Progress analysis',
      'Comparison',
      'Technique / how-to',
      'Workout /',
      'Program (multi-day',
      'Coaching recommendation',
      'Explanation / concept',
      'Multi-topic',
      'Missing / thin data',
      'NUMBERED steps',
    ]) {
      assert.match(
        COACH_SYSTEM_PROMPT,
        new RegExp(shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        `missing shape guidance for ${shape}`,
      )
    }
  })

  it('forbids collapsing every answer into identical bullets', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Same bullet template for every answer/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Unordered bullets for ordered steps/i,
    )
  })

  it('locks terminology, verified math, and data-driven tone', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Strict fitness\/anatomical terminology/i)
    assert.match(COACH_SYSTEM_PROMPT, /deadlifts, not "deadlocks"/i)
    assert.match(COACH_SYSTEM_PROMPT, /verify step-by-step/i)
    assert.match(COACH_SYSTEM_PROMPT, /data-driven/i)
    assert.match(COACH_SYSTEM_PROMPT, /never generic motivational clich/i)
  })

  it('requires general answers to also use personal training_history', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Always pair general fitness knowledge/i)
    assert.match(COACH_SYSTEM_PROMPT, /training_history/i)
    assert.match(COACH_SYSTEM_PROMPT, /significant_breaks/i)
    assert.match(COACH_SYSTEM_PROMPT, /how long until muscle growth/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Textbook-only timelines when training_history/i,
    )
  })

  it('points the model at rich USER_DATA sections', () => {
    assert.match(COACH_SYSTEM_PROMPT, /exercise_performance/i)
    assert.match(COACH_SYSTEM_PROMPT, /schedule\.last_trained_by_day/i)
    assert.match(COACH_SYSTEM_PROMPT, /body_weight\.summary/i)
    assert.match(COACH_SYSTEM_PROMPT, /active_session/i)
    assert.match(COACH_SYSTEM_PROMPT, /Dig into the right USER_DATA section/i)
  })

  it('enforces single-turn replies to protect message quota', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Quota \/ single-turn/i)
    assert.match(COACH_SYSTEM_PROMPT, /ONE reply/i)
    assert.match(COACH_SYSTEM_PROMPT, /Do not invent tool calls/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /splitting one answer across quota-burning turns/i,
    )
  })

  it('allows comparison tables and executable workout formatting', () => {
    assert.match(COACH_SYSTEM_PROMPT, /pipe tables/i)
    assert.match(COACH_SYSTEM_PROMPT, /3 × 6–8/i)
    assert.match(COACH_SYSTEM_PROMPT, /Target: 155 lb/i)
    assert.match(COACH_SYSTEM_PROMPT, /Information hierarchy/i)
  })
})
