import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  COACH_ACTIONS_PROMPT,
  COACH_BASE_PROMPT,
  COACH_MECHANICS_PROMPT,
  COACH_SYSTEM_PROMPT,
  buildCoachSystemPrompt,
} from '../prompt'
import { inferCoachIntent } from '../intent'

/**
 * Contracts the Coach prompt must keep. These lock the BEHAVIOURS found
 * lacking in the baseline audit (guessed arguments, workouts for one-word asks,
 * recommendations that contradict themselves, overclaimed actions), not exact
 * wording — change the prose freely as long as each rule is still said.
 */
const CONTRACTS: { id: string; part: string; mustMatch: RegExp[] }[] = [
  {
    id: 'answer-first-and-commit',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Lead with the answer/i,
      /Commit when the evidence supports a decision/i,
      /Do not close with a line that undoes it/i,
    ],
  },
  {
    id: 'simple-stays-simple',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Simple question = simple answer/i,
      /Educational questions stay educational/i,
    ],
  },
  {
    id: 'exact-output-shape',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Deliver the shape they ask for/i,
      /"3 things" is exactly 3 bullets/i,
      /numbered when ranked/i,
    ],
  },
  {
    id: 'short-messages-are-not-workouts',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Short messages \("Bench\?", "Today\?", "Why\?"\)/,
      /never a workout or a primer/i,
      /only when they ask for one/i,
    ],
  },
  {
    id: 'personalization-gate',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Required .*Useful/i,
      /never mention PRs, volume, streaks or body weight just because they are available/i,
      /only source of personal facts/i,
    ],
  },
  {
    id: 'units-and-dates-are-given-not-derived',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /already in the user's unit/i,
      /do not convert/i,
      /as_of_weekday/,
    ],
  },
  {
    id: 'like-for-like-and-pr-honesty',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Compare like for like/i,
      /per-hand dumbbell/i,
      /PR count is not proof of strength/i,
    ],
  },
  {
    id: 'consistency',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /closing recommendation must agree with your opening takeaway/i,
      /Say "you mentioned"|"you mentioned"/i,
    ],
  },
  {
    id: 'evidence-and-confidence',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Keep what the data shows, what it may mean, and what to do separate/i,
      /Match confidence to evidence/i,
    ],
  },
  {
    id: 'safety-first',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /first sentence is the safety action/i,
      /do not push through/i,
      /Do not diagnose/i,
    ],
  },
  {
    id: 'format-rules',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /Simple answers are plain prose/i,
      /Never write a bold line followed by a sentence on the next line unless it is an exercise block/i,
      /\*\*Barbell Squat\*\*/,
      /Target: \*\*70 lb\*\*/,
    ],
  },
  {
    id: 'worked-examples',
    part: COACH_BASE_PROMPT,
    mustMatch: [
      /<examples>/,
      /never treat them as the user's data or reuse them in tool calls/i,
      /Which weight is wrong, and what should it be\?/,
    ],
  },
  {
    id: 'act-ask-decline',
    part: COACH_ACTIONS_PROMPT,
    mustMatch: [
      /Decide act \/ ask \/ decline/i,
      /never guess, and never reuse numbers from examples or tool descriptions/i,
      /DECLINE plainly when no tool covers it/i,
      /Never substitute a different tool/i,
      /never describe an effect the card does not show/i,
    ],
  },
  {
    id: 'never-claim-applied',
    part: COACH_ACTIONS_PROMPT,
    mustMatch: [/Never say a change is applied/i, /Never mention auto-start/i],
  },
  {
    id: 'grind-rules',
    part: COACH_MECHANICS_PROMPT,
    mustMatch: [
      /Streak:/,
      /Sunday–Saturday week/i,
      /weight×reps/,
      /Skip markers/i,
      /triangular/i,
    ],
  },
]

const ALL_TOOLS = [
  'propose_correct_weights',
  'propose_edit_session_log',
  'propose_start_workout',
  'propose_create_day',
  'propose_apply_weekly_plan',
  'propose_log_body_weight',
  'propose_delete_body_weight',
  'propose_finish_workout',
  'propose_undo_finish_workout',
  'propose_skip_sets',
  'propose_toggle_rest_today',
  'propose_set_rest_weekday',
  'propose_edit_exercise',
  'propose_set_day_enabled',
  'propose_update_rotation',
  'propose_update_notification_prefs',
]

describe('Coach prompt contracts', () => {
  for (const c of CONTRACTS) {
    it(`contract: ${c.id}`, () => {
      for (const pattern of c.mustMatch) {
        assert.match(c.part, pattern, `contract ${c.id} missing ${pattern}`)
      }
    })
  }

  it('names every action tool the model can call', () => {
    for (const tool of ALL_TOOLS) {
      assert.match(COACH_ACTIONS_PROMPT, new RegExp(tool), `missing ${tool}`)
    }
  })

  it('uses one tag style and states the stable parts before volatile ones', () => {
    for (const tag of ['role', 'how_to_respond', 'personal_data', 'safety', 'format', 'examples', 'voice']) {
      assert.match(COACH_BASE_PROMPT, new RegExp(`<${tag}>`))
      assert.match(COACH_BASE_PROMPT, new RegExp(`</${tag}>`))
    }
  })

  it('avoids the shouting that pushes weaker models to over-trigger', () => {
    assert.doesNotMatch(COACH_SYSTEM_PROMPT, /not suggestions/i)
    assert.doesNotMatch(COACH_SYSTEM_PROMPT, /CRITICAL|MUST NOT|ALWAYS/)
  })

  it('stays within a free-tier-friendly size budget', () => {
    assert.ok(COACH_SYSTEM_PROMPT.length < 16000, `too long: ${COACH_SYSTEM_PROMPT.length}`)
    assert.ok(COACH_SYSTEM_PROMPT.length > 5000, `too short: ${COACH_SYSTEM_PROMPT.length}`)
  })
})

describe('buildCoachSystemPrompt', () => {
  const base = { userDataJson: '{"as_of_weekday":"Monday"}', recentActions: null, turnReminder: 'REMINDER' }

  it('puts stable instructions first, then USER_DATA, then this turn', () => {
    const p = buildCoachSystemPrompt({
      ...base,
      profile: { mechanics: true, toolPolicy: 'all' },
    })
    const order = ['<role>', '<grind_mechanics>', '<actions>', '<user_data>', '<this_turn>']
    let last = -1
    for (const marker of order) {
      const at = p.indexOf(marker)
      assert.ok(at > last, `${marker} out of order`)
      last = at
    }
    assert.match(p, /"as_of_weekday":"Monday"/)
    assert.match(p, /REMINDER\n<\/this_turn>$/)
  })

  it('leaves out the GRIND rules and the action rules when the turn cannot use them', () => {
    const p = buildCoachSystemPrompt({
      ...base,
      profile: { mechanics: false, toolPolicy: 'none' },
    })
    assert.doesNotMatch(p, /<grind_mechanics>/)
    assert.doesNotMatch(p, /<actions>/)
    assert.match(p, /<role>/)
  })

  it('includes recent actions only when there are some, and says pending is not applied', () => {
    const without = buildCoachSystemPrompt({ ...base, profile: { mechanics: true, toolPolicy: 'all' } })
    assert.doesNotMatch(without, /<recent_actions>/)
    const withActions = buildCoachSystemPrompt({
      ...base,
      recentActions: '- 2 min ago · Edit exercise · PENDING — not applied yet',
      profile: { mechanics: true, toolPolicy: 'all' },
    })
    assert.match(withActions, /<recent_actions>/)
    assert.match(withActions, /pending card has NOT been applied/i)
  })

  it('pure Q&A intents drop the tools; "why" style intents keep the rules', () => {
    assert.equal(inferCoachIntent('What does RIR mean?').toolPolicy, 'none')
    assert.equal(inferCoachIntent('What does RIR mean?').mechanics, false)
    assert.equal(inferCoachIntent('Why did my streak reset?').mechanics, true)
    assert.equal(inferCoachIntent('Bench?').toolPolicy, 'all')
  })
})
