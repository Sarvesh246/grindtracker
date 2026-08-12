import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COACH_SYSTEM_PROMPT } from '../prompt'

describe('COACH_SYSTEM_PROMPT', () => {
  it('requires strategy over templates for every reply', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Strategy, not template/i)
    assert.match(COACH_SYSTEM_PROMPT, /typed questions and starter chips/i)
    assert.match(COACH_SYSTEM_PROMPT, /Simple question = simple answer/i)
    assert.match(COACH_SYSTEM_PROMPT, /Never make a short question artificially long/i)
  })

  it('defines proportional response-size heuristics, not forced sections', () => {
    for (const shape of [
      'Definition / simple fact',
      'Direct recommendation',
      'Workout',
      'Technique',
      'Comparison',
      'Analysis',
      'Complex coaching',
      'numbered steps',
    ]) {
      assert.match(
        COACH_SYSTEM_PROMPT,
        new RegExp(shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        `missing heuristic for ${shape}`,
      )
    }
    assert.match(COACH_SYSTEM_PROMPT, /not a checklist to fill/i)
  })

  it('forbids forced structure and forced personalization', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Do NOT automatically add/i)
    assert.match(COACH_SYSTEM_PROMPT, /Personalization threshold/i)
    assert.match(COACH_SYSTEM_PROMPT, /What is RIR/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Forcing personal history onto definition\/concept questions/i,
    )
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Auto-adding Application \/ Logging \/ Why/i,
    )
  })

  it('locks terminology, verified math, and coach tone', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Strict fitness\/anatomical terminology/i)
    assert.match(COACH_SYSTEM_PROMPT, /deadlifts, not "deadlocks"/i)
    assert.match(COACH_SYSTEM_PROMPT, /verify before stating/i)
    assert.match(COACH_SYSTEM_PROMPT, /Never generic motivational clich/i)
  })

  it('personalizes only when it improves the answer', () => {
    assert.match(COACH_SYSTEM_PROMPT, /ONLY when they help answer the specific ask/i)
    assert.match(COACH_SYSTEM_PROMPT, /training_history/i)
    assert.match(COACH_SYSTEM_PROMPT, /significant_breaks/i)
    assert.match(COACH_SYSTEM_PROMPT, /how long until muscle growth/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Would personal USER_DATA change or improve/i,
    )
  })

  it('points the model at rich USER_DATA sections when relevant', () => {
    assert.match(COACH_SYSTEM_PROMPT, /exercise_performance/i)
    assert.match(COACH_SYSTEM_PROMPT, /schedule\.last_trained_by_day/i)
    assert.match(COACH_SYSTEM_PROMPT, /body_weight\.summary/i)
    assert.match(COACH_SYSTEM_PROMPT, /active_session/i)
    assert.match(COACH_SYSTEM_PROMPT, /when personalization IS warranted/i)
  })

  it('enforces single-turn replies to protect message quota', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Quota \/ single-turn/i)
    assert.match(COACH_SYSTEM_PROMPT, /ONE reply/i)
    assert.match(COACH_SYSTEM_PROMPT, /No tool calls/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /splitting across quota-burning turns/i,
    )
  })

  it('prefers one clear recommendation and proportional workout formatting', () => {
    assert.match(COACH_SYSTEM_PROMPT, /one clear recommendation/i)
    assert.match(COACH_SYSTEM_PROMPT, /Use 95 lb today/i)
    assert.match(COACH_SYSTEM_PROMPT, /sets×reps/i)
    assert.match(COACH_SYSTEM_PROMPT, /pipe table/i)
  })
})
