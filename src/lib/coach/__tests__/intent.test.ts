import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCoachTurnReminder,
  inferCoachIntent,
  type CoachIntent,
} from '../intent'
import { COACH_STRESS_CATALOG } from '../stressCatalog'
import { COACH_SYSTEM_PROMPT } from '../prompt'

/** Representative prompts that MUST land on different intents + budgets. */
const DIVERGENT_CASES: { prompt: string; intent: CoachIntent }[] = [
  { prompt: 'What does RIR mean?', intent: 'definition' },
  { prompt: 'What is hypertrophy?', intent: 'definition' },
  { prompt: 'What weight should I use today?', intent: 'recommendation' },
  { prompt: 'Should I increase the weight?', intent: 'recommendation' },
  { prompt: 'Give me a leg workout.', intent: 'workout' },
  { prompt: 'Make me a 45-minute workout.', intent: 'workout' },
  { prompt: 'How do I do an RDL?', intent: 'technique' },
  { prompt: 'Why am I not feeling my lats?', intent: 'troubleshooting' },
  { prompt: 'Am I getting stronger?', intent: 'analysis' },
  {
    prompt: 'What are the three biggest things holding me back?',
    intent: 'analysis',
  },
  { prompt: 'Dumbbell bench vs barbell bench', intent: 'comparison' },
  { prompt: 'Make me a Push/Pull/Legs program.', intent: 'program' },
  { prompt: 'Bench?', intent: 'short_contextual' },
  { prompt: 'Why?', intent: 'short_contextual' },
  {
    prompt: 'My shoulder hurts when I bench. Should I push through?',
    intent: 'safety',
  },
]

describe('inferCoachIntent', () => {
  it('classifies divergent intents without per-prompt format instructions', () => {
    for (const c of DIVERGENT_CASES) {
      const profile = inferCoachIntent(c.prompt, 'What should I do for bench today?')
      assert.equal(
        profile.intent,
        c.intent,
        `"${c.prompt}" → ${profile.intent}, expected ${c.intent}`,
      )
    }
  })

  it('assigns materially different token budgets by intent family', () => {
    const definition = inferCoachIntent('What is RIR?')
    const recommendation = inferCoachIntent('What weight should I use today?')
    const workout = inferCoachIntent('Give me a leg workout.')
    const analysis = inferCoachIntent('Analyze my progress.')
    const program = inferCoachIntent('Build me a 4-day program.')

    // Simple educational asks must be capped well below workout/program.
    assert.ok(
      definition.maxOutputTokens < recommendation.maxOutputTokens,
      'definition should be shorter than recommendation',
    )
    assert.ok(
      recommendation.maxOutputTokens < workout.maxOutputTokens,
      'recommendation should be shorter than workout',
    )
    assert.ok(
      definition.maxOutputTokens * 2 < workout.maxOutputTokens,
      'definition budget must be < half of workout budget',
    )
    assert.ok(analysis.maxOutputTokens >= 900)
    assert.ok(program.maxOutputTokens >= workout.maxOutputTokens)
    assert.ok(definition.maxOutputTokens <= 320)
  })

  it('uses different reminders so the model is steered by intent, not one template', () => {
    const definition = buildCoachTurnReminder(inferCoachIntent('What is RIR?'))
    const workout = buildCoachTurnReminder(inferCoachIntent('Give me a leg workout.'))
    const safety = buildCoachTurnReminder(
      inferCoachIntent('My knee hurts when I squat.'),
    )
    const short = buildCoachTurnReminder(inferCoachIntent('Why?', 'Use 95 lb today.'))

    assert.match(definition, /definition\/education/i)
    assert.match(definition, /No personal history/i)
    assert.match(workout, /executable workout/i)
    assert.match(safety, /safety/i)
    assert.match(short, /short contextual/i)

    // Reminders must actually differ — same text would collapse behavior.
    assert.notEqual(definition, workout)
    assert.notEqual(workout, safety)
    assert.notEqual(definition, short)
  })

  it('marks definition personalization unnecessary and analysis required', () => {
    assert.equal(inferCoachIntent('What is a deload?').personalization, 'unnecessary')
    assert.equal(inferCoachIntent('Am I getting stronger?').personalization, 'required')
    assert.equal(inferCoachIntent('Give me a pull day.').personalization, 'useful')
  })

  it('treats bare Why? as short contextual when prior turn exists', () => {
    const profile = inferCoachIntent('Why?', 'Use 95 lb on bench today.')
    assert.equal(profile.intent, 'short_contextual')
  })

  it('covers stress-catalog prompts with diverging budgets across categories', () => {
    const byCategory = new Map<string, number[]>()
    for (const c of COACH_STRESS_CATALOG) {
      const prior =
        c.category === 'short_contextual' ? 'What should I do for bench today?' : null
      const profile = inferCoachIntent(c.prompt, prior)
      const list = byCategory.get(c.category) ?? []
      list.push(profile.maxOutputTokens)
      byCategory.set(c.category, list)
    }

    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    const factAvg = avg(byCategory.get('simple_factual')!)
    const workoutAvg = avg(byCategory.get('workout_generation')!)
    const safetyAvg = avg(byCategory.get('safety')!)

    assert.ok(
      factAvg < workoutAvg,
      `simple_factual avg tokens (${factAvg}) should be < workout (${workoutAvg})`,
    )
    assert.ok(safetyAvg > 0)
    // At least 4 distinct budgets across the catalog → not one-size-fits-all.
    const distinct = new Set(
      COACH_STRESS_CATALOG.map(c => inferCoachIntent(c.prompt).maxOutputTokens),
    )
    assert.ok(
      distinct.size >= 4,
      `expected ≥4 distinct budgets, got ${distinct.size}`,
    )
  })
it('classifies mutation asks as actionable', () => {
    assert.equal(
      inferCoachIntent('Change my bench from 90 to 95 lb').intent,
      'actionable',
    )
    assert.equal(
      inferCoachIntent('Start today’s workout').intent,
      'actionable',
    )
    assert.equal(
      inferCoachIntent('Create a new day called upper from that plan').intent,
      'actionable',
    )
    assert.equal(inferCoachIntent('Start push').intent, 'actionable')
    assert.equal(inferCoachIntent('start legs').intent, 'actionable')
    assert.equal(inferCoachIntent('Train now').intent, 'actionable')
    assert.equal(inferCoachIntent('Create an upper day').intent, 'actionable')
    assert.equal(
      inferCoachIntent('Fix my bench weights from 90 to 95').intent,
      'actionable',
    )
    assert.equal(inferCoachIntent('Log my body weight').intent, 'actionable')
    assert.equal(inferCoachIntent('I weigh 180').intent, 'actionable')
    assert.equal(
      inferCoachIntent("Delete yesterday's weigh-in").intent,
      'actionable',
    )
    assert.equal(inferCoachIntent('Finish my workout').intent, 'actionable')
    assert.equal(inferCoachIntent("I'm done training").intent, 'actionable')
    assert.equal(inferCoachIntent('Undo that finish').intent, 'actionable')
    assert.equal(
      inferCoachIntent('Skip the last set of bench').intent,
      'actionable',
    )
    assert.equal(inferCoachIntent('Unskip squats').intent, 'actionable')
    assert.equal(inferCoachIntent('Rest today').intent, 'actionable')
    assert.equal(inferCoachIntent('Taking today off').intent, 'actionable')
    assert.equal(inferCoachIntent('Always rest on Sunday').intent, 'actionable')
    assert.equal(
      inferCoachIntent('Change my bench to 4 sets').intent,
      'actionable',
    )
    assert.equal(inferCoachIntent('Bump bench up a bit').intent, 'actionable')
    assert.equal(inferCoachIntent('Reorder my days').intent, 'actionable')
    assert.equal(
      inferCoachIntent('that squat set was wrong, it was actually 8 not 5').intent,
      'actionable',
    )
    assert.equal(inferCoachIntent('I actually did 8 reps').intent, 'actionable')
    assert.equal(
      inferCoachIntent('Turn off notifications').intent,
      'actionable',
    )
    assert.equal(
      inferCoachIntent('Move my streak reminder to 6pm').intent,
      'actionable',
    )
  })

  it('does not treat advisory start/weight questions as actionable', () => {
    const shouldStart = inferCoachIntent('Should I start my workout?')
    assert.notEqual(shouldStart.intent, 'actionable')
    assert.equal(shouldStart.intent, 'recommendation')
    assert.notEqual(inferCoachIntent('Should I rest today?').intent, 'actionable')
    assert.notEqual(
      inferCoachIntent('Should I skip this set?').intent,
      'actionable',
    )
    assert.notEqual(
      inferCoachIntent('Can I turn off notifications?').intent,
      'actionable',
    )
  })
})

describe('COACH_SYSTEM_PROMPT intent emergence', () => {
  it('forbids reusable templates and treats format lists as calibration only', () => {
    assert.match(
      COACH_SYSTEM_PROMPT,
      /format must emerge from THIS ask/i,
    )
    assert.match(
      COACH_SYSTEM_PROMPT,
      /NOT templates to fill/i,
    )
    assert.match(
      COACH_SYSTEM_PROMPT,
      /do not start from a format menu/i,
    )
  })
})
