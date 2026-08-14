import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { COACH_SYSTEM_PROMPT } from '../prompt'

/**
 * Behavioral contracts from Adaptive Response Behavior system rules.
 * Prefer root-cause rules in the system prompt over per-question patches.
 */
const STRESS_CONTRACTS = [
  {
    id: 'intent-before-formatting',
    mustMatch: [
      /Intent before formatting/i,
      /Never pick a template before identifying intent/i,
      /Understand intent → assess complexity → determine relevance → choose depth → choose format → answer → verify/i,
    ],
  },
  {
    id: 'forced-formatting',
    mustMatch: [
      /Minimum necessary structure/i,
      /Do NOT automatically add/i,
      /Application \/ Logging \/ Why \/ Key Takeaway \/ Progression/i,
      /Personal History/i,
    ],
  },
  {
    id: 'personalization-threshold',
    mustMatch: [
      /Personalization gate/i,
      /Required: cannot answer correctly/i,
      /Useful:/i,
      /Unnecessary:/i,
      /What is RIR\?/i,
      /"Explain X" ≠ "tell me what I should personally do about X\."/i,
    ],
  },
  {
    id: 'relevance-not-completeness',
    mustMatch: [
      /Relevance over completeness/i,
      /Prefer relevant evidence over all available evidence/i,
      /Do not dump every metric/i,
    ],
  },
  {
    id: 'decision-commitment',
    mustMatch: [
      /Recommendation commitment/i,
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
      /Confidence language must match evidence/i,
      /one possible explanation/i,
    ],
  },
  {
    id: 'output-shape',
    mustMatch: [
      /Exact output-shape compliance/i,
      /exactly 3 prioritized items/i,
      /yes\/no/i,
    ],
  },
  {
    id: 'context-continuity',
    mustMatch: [
      /Context hierarchy/i,
      /Explicit current request/i,
      /Short-message behavior/i,
      /must not be overridden by older context/i,
    ],
  },
  {
    id: 'no-internal-jargon',
    mustMatch: [
      /No internal\/database language/i,
      /manual rotation/i,
      /catalog/i,
    ],
  },
  {
    id: 'data-integrity',
    mustMatch: [
      /Data integrity/i,
      /25 b/i,
      /90 min/i,
      /Never fabricate missing numbers/i,
    ],
  },
  {
    id: 'consistency',
    mustMatch: [
      /Internal consistency/i,
      /balanced and a major category neglected/i,
    ],
  },
  {
    id: 'safety',
    mustMatch: [
      /Safety \(overrides performance\)/i,
      /Do not diagnose/i,
      /Do not encourage pushing through/i,
      /Safety concern → immediate action/i,
    ],
  },
  {
    id: 'troubleshooting',
    mustMatch: [
      /Troubleshooting \("Why\?"\)/i,
      /Do not assert a single cause unless evidence is strong/i,
    ],
  },
  {
    id: 'quality-check',
    mustMatch: [
      /Final quality check/i,
      /Answered the actual question/i,
      /Evidence vs interpretation separated/i,
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
    ],
  },
  {
    id: 'progressive-disclosure',
    mustMatch: [
      /Layer 1 = immediate answer/i,
      /must not need Layer 3 to understand Layer 1/i,
    ],
  },
] as const

describe('COACH_SYSTEM_PROMPT', () => {
  it('requires adaptive coach sequence over templates', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Behavioral requirements \(not suggestions\)/i)
    assert.match(COACH_SYSTEM_PROMPT, /adaptive coach/i)
    assert.match(COACH_SYSTEM_PROMPT, /typed questions and starter chips/i)
    assert.match(COACH_SYSTEM_PROMPT, /Simple question = simple answer/i)
    assert.match(
      COACH_SYSTEM_PROMPT,
      /Never make a short question artificially long/i,
    )
    assert.match(
      COACH_SYSTEM_PROMPT,
      /NOT more detail \+ more personalization \+ more formatting/i,
    )
    assert.match(COACH_SYSTEM_PROMPT, /format must emerge from THIS ask/i)
    assert.match(COACH_SYSTEM_PROMPT, /NOT templates to fill/i)
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
      'numbered',
    ]) {
      assert.match(
        COACH_SYSTEM_PROMPT,
        new RegExp(shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
        `missing heuristic for ${shape}`,
      )
    }
  })

  it('forbids forced structure and forced personalization', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Do NOT automatically add/i)
    assert.match(COACH_SYSTEM_PROMPT, /Personalization gate/i)
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
    assert.match(COACH_SYSTEM_PROMPT, /Strict fitness terminology/i)
    assert.match(COACH_SYSTEM_PROMPT, /deadlifts, not "deadlocks"/i)
    assert.match(COACH_SYSTEM_PROMPT, /verify math/i)
    assert.match(COACH_SYSTEM_PROMPT, /Never generic motivational clich/i)
  })

  it('personalizes only when Required or Useful', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Only use personal history when Required or Useful/i)
    assert.match(COACH_SYSTEM_PROMPT, /training_history/i)
    assert.match(COACH_SYSTEM_PROMPT, /significant_breaks/i)
    assert.match(COACH_SYSTEM_PROMPT, /Personalization gate/i)
  })

  it('points the model at rich USER_DATA sections when relevant', () => {
    assert.match(COACH_SYSTEM_PROMPT, /exercise_performance/i)
    assert.match(COACH_SYSTEM_PROMPT, /schedule\.last_trained_by_day/i)
    assert.match(COACH_SYSTEM_PROMPT, /body_weight\.summary/i)
    assert.match(COACH_SYSTEM_PROMPT, /active_session/i)
    assert.match(COACH_SYSTEM_PROMPT, /notifications/i)
    assert.match(COACH_SYSTEM_PROMPT, /when personalization IS Required or Useful/i)
  })

  it('enforces single-turn replies and confirm-before-apply tools', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Quota \/ single-turn/i)
    assert.match(COACH_SYSTEM_PROMPT, /ONE reply/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_correct_weights/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_start_workout/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_create_day/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_log_body_weight/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_delete_body_weight/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_finish_workout/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_undo_finish_workout/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_skip_sets/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_toggle_rest_today/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_set_rest_weekday/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_edit_exercise/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_update_rotation/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_edit_session_log/i)
    assert.match(COACH_SYSTEM_PROMPT, /propose_update_notification_prefs/i)
    assert.match(COACH_SYSTEM_PROMPT, /Never claim a change is applied/i)
    assert.match(COACH_SYSTEM_PROMPT, /must NOT start a workout/i)
    assert.match(COACH_SYSTEM_PROMPT, /GRIND mechanics/i)
    assert.match(COACH_SYSTEM_PROMPT, /weight×reps/i)
    assert.match(COACH_SYSTEM_PROMPT, /Skip markers/i)
    assert.match(COACH_SYSTEM_PROMPT, /splitting across quota-burning turns/i)
  })

  it('prefers one clear recommendation and proportional workout formatting', () => {
    assert.match(COACH_SYSTEM_PROMPT, /make ONE/i)
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
    assert.ok(
      COACH_SYSTEM_PROMPT.length < 16000,
      `prompt too long: ${COACH_SYSTEM_PROMPT.length}`,
    )
    assert.ok(
      COACH_SYSTEM_PROMPT.length > 5000,
      `prompt unexpectedly short: ${COACH_SYSTEM_PROMPT.length}`,
    )
  })
})
