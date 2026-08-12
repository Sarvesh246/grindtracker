import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COACH_SYSTEM_PROMPT } from '../prompt'

/**
 * Behavioral contracts derived from Coach stress-testing.
 * Prefer root-cause rules in the system prompt over per-question patches.
 */
const STRESS_CONTRACTS = [
  {
    id: 'forced-formatting',
    mustMatch: [
      /minimum structure/i,
      /Do NOT automatically add/i,
      /Auto-adding Application \/ Logging \/ Why/i,
      /not a checklist to fill/i,
    ],
  },
  {
    id: 'personalization-threshold',
    mustMatch: [
      /Personalization: required \/ useful \/ unnecessary/i,
      /What is RIR\?/i,
      /Do NOT add logging gaps/i,
      /"Explain X" ≠ "tell me what to do about X\."/i,
    ],
  },
  {
    id: 'relevance-not-completeness',
    mustMatch: [
      /lifetime volume/i,
      /do not dump every metric/i,
      /Treating more metrics/i,
    ],
  },
  {
    id: 'decision-commitment',
    mustMatch: [
      /ONE clear recommendation/i,
      /Use 95 lb today/i,
      /You could do A, B, or C/i,
      /Decision → brief reason → fallback/i,
    ],
  },
  {
    id: 'causal-calibration',
    mustMatch: [
      /Evidence vs interpretation/i,
      /likely.*suggests.*may be contributing/i,
      /Causal overconfidence/i,
      /Confidence language/i,
    ],
  },
  {
    id: 'output-shape',
    mustMatch: [
      /Output-shape following/i,
      /exactly three prioritized items/i,
      /yes\/no/i,
    ],
  },
  {
    id: 'context-continuity',
    mustMatch: [
      /Intent priority/i,
      /Explicit current request/i,
      /Short prompts/i,
      /Multi-turn/i,
      /override a clear current ask/i,
    ],
  },
  {
    id: 'no-internal-jargon',
    mustMatch: [
      /full lower-body catalog/i,
      /manual rotation/i,
      /Internal\/database jargon/i,
    ],
  },
  {
    id: 'data-integrity',
    mustMatch: [
      /25 b/i,
      /90 min/i,
      /Verify every number, unit, date/i,
    ],
  },
  {
    id: 'consistency',
    mustMatch: [
      /internally consistent/i,
      /Contradicting yourself/i,
    ],
  },
  {
    id: 'safety',
    mustMatch: [
      /Safety \(overrides performance\)/i,
      /Do not diagnose/i,
      /Do not encourage pushing through/i,
    ],
  },
  {
    id: 'shape-heuristics',
    mustMatch: [
      /Definition \/ simple fact/i,
      /Direct recommendation/i,
      /Workout/i,
      /Technique/i,
      /Troubleshooting/i,
      /Comparison/i,
      /Progress analysis/i,
      /Program design/i,
      /Complex coaching/i,
      /Conflicting goals/i,
    ],
  },
  {
    id: 'progressive-disclosure',
    mustMatch: [
      /Layer 1 = immediate answer/i,
      /Core principle/i,
      /exactly what is most useful/i,
    ],
  },
] as const

describe('COACH_SYSTEM_PROMPT', () => {
  it('requires strategy over templates for every reply', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Core principle/i)
    assert.match(COACH_SYSTEM_PROMPT, /typed questions and starter chips/i)
    assert.match(COACH_SYSTEM_PROMPT, /Simple question = simple answer/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Never make a short question artificially long/i,
    )
    assert.match(
      COACH_SYSTEM_PROMPT,
      /More data, formatting, personalization, or explanation is NOT automatically better/i,
    )
  })

  it('defines proportional response-size heuristics, not forced sections', () => {
    for (const shape of [
      'Definition / simple fact',
      'Direct recommendation',
      'Workout',
      'Technique',
      'Comparison',
      'Progress analysis',
      'Complex coaching',
      'Troubleshooting',
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
    assert.match(COACH_SYSTEM_PROMPT, /Personalization: required/i)
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
    assert.match(COACH_SYSTEM_PROMPT, /verify math/i)
    assert.match(COACH_SYSTEM_PROMPT, /Never generic motivational clich/i)
  })

  it('personalizes only when it improves the answer', () => {
    assert.match(COACH_SYSTEM_PROMPT, /ONLY when they help THIS ask/i)
    assert.match(COACH_SYSTEM_PROMPT, /training_history/i)
    assert.match(COACH_SYSTEM_PROMPT, /significant_breaks/i)
    assert.match(COACH_SYSTEM_PROMPT, /what weight today/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Personalization: required \/ useful \/ unnecessary/i,
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
    assert.match(COACH_SYSTEM_PROMPT, /ONE clear recommendation/i)
    assert.match(COACH_SYSTEM_PROMPT, /Use 95 lb today/i)
    assert.match(COACH_SYSTEM_PROMPT, /Visual hierarchy/i)
    assert.match(COACH_SYSTEM_PROMPT, /\*\*Barbell Squat\*\*/)
    assert.match(COACH_SYSTEM_PROMPT, /Target: \*\*70 lb\*\*/)
    assert.match(COACH_SYSTEM_PROMPT, /pipe table/i)
  })

  for (const contract of STRESS_CONTRACTS) {
    it(`stress contract: ${contract.id}`, () => {
      for (const pattern of contract.mustMatch) {
        assert.match(
          COACH_SYSTEM_PROMPT,
          pattern,
          `contract ${contract.id} missing ${pattern}`,
        )
      }
    })
  }

  it('stays within a free-tier-friendly size budget', () => {
    // Dense rules beat a novel; leave headroom for USER_DATA + history.
    assert.ok(
      COACH_SYSTEM_PROMPT.length < 11000,
      `prompt too long: ${COACH_SYSTEM_PROMPT.length}`,
    )
    assert.ok(
      COACH_SYSTEM_PROMPT.length > 4500,
      `prompt unexpectedly short: ${COACH_SYSTEM_PROMPT.length}`,
    )
  })
})
