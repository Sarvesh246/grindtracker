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

    // Ceilings are a safety net now (brevity comes from the reminders), but a
    // plain definition must still be capped far below a workout or program.
    assert.ok(
      definition.maxOutputTokens < recommendation.maxOutputTokens,
      'definition should be shorter than recommendation',
    )
    assert.ok(
      definition.maxOutputTokens * 2 < workout.maxOutputTokens,
      'definition budget must be < half of workout budget',
    )
    assert.ok(analysis.maxOutputTokens >= 900)
    assert.ok(program.maxOutputTokens >= workout.maxOutputTokens)
    assert.ok(definition.maxOutputTokens <= 500)
  })

  it('gives self-consistency-sensitive advice thinking headroom, and nothing else', () => {
    for (const prompt of [
      'What weight should I use today?',
      'Dumbbell bench vs barbell bench',
      'Am I getting stronger?',
    ]) {
      const p = inferCoachIntent(prompt)
      assert.equal(p.thinking, 'low', prompt)
      // Thinking tokens count against the same limit, so they need room.
      assert.ok(p.maxOutputTokens >= 1500, `${prompt} → ${p.maxOutputTokens}`)
    }
    for (const prompt of ['What does RIR mean?', 'Bench?', 'Rest today']) {
      assert.equal(inferCoachIntent(prompt).thinking, 'none', prompt)
    }
  })

  it('does not let an incidental safety word hijack a long message', () => {
    const doctorStory =
      "My doctor told me last month that I should lift more for bone density, so I've been doing three days a week and feeling good about it. I'm wondering if adding a fourth day would be worth it or if I'm just going to burn out."
    assert.notEqual(inferCoachIntent(doctorStory).intent, 'safety')
    assert.notEqual(inferCoachIntent("My legs are sore, should I train today?").intent, 'safety')
  })

  it('treats questions about their OWN data as personal, not as definitions', () => {
    assert.notEqual(inferCoachIntent("What's my streak?").intent, 'definition')
    assert.notEqual(inferCoachIntent('What is my best squat?').intent, 'definition')
    assert.equal(inferCoachIntent("What's my streak?").personalization, 'required')
    assert.equal(inferCoachIntent('What is RIR?').intent, 'definition')
    assert.equal(inferCoachIntent('What muscles does the RDL work?').intent, 'definition')
  })

  it('routes "why won\'t it move" stories to troubleshooting even when they mention form', () => {
    assert.equal(
      inferCoachIntent(
        "My squat has been stuck for six weeks and the form feels fine. Why won't it move?",
      ).intent,
      'troubleshooting',
    )
    assert.equal(inferCoachIntent('How do I do an RDL?').intent, 'technique')
  })

  it('tells the model to bullet a message that asks several things', () => {
    const multi = buildCoachTurnReminder(
      inferCoachIntent('Three quick things: how many sets of bench am I doing, what was my best squat, and am I due for a rest day?'),
    )
    assert.match(multi, /each in its own bullet/i)
    assert.match(buildCoachTurnReminder(inferCoachIntent('What is RIR? And what is RPE?')), /each in its own bullet/i)
    assert.doesNotMatch(buildCoachTurnReminder(inferCoachIntent('What is RIR?')), /own bullet/i)
  })

  it('still routes real symptom reports to safety, mild ones included', () => {
    assert.equal(inferCoachIntent('My shoulder has a sharp pain when I press').intent, 'safety')
    assert.equal(inferCoachIntent('I feel dizzy halfway through sets').intent, 'safety')
    assert.equal(
      inferCoachIntent(
        'yo so like i been hitting legs hard n my knees kinda feel weird lol not pain pain just weird, should i keep going or nah',
      ).intent,
      'safety',
    )
    // A long message still counts when the symptom is first-person.
    const long = `${'Work has been busy and I have been training anyway. '.repeat(10)}My knee hurts on the way down.`
    assert.equal(inferCoachIntent(long).intent, 'safety')
  })

  it('tells change requests to ask rather than guess, and to cover every change', () => {
    const r = buildCoachTurnReminder(inferCoachIntent('Fix my bench numbers.'))
    assert.match(r, /ask ONE short question/i)
    assert.match(r, /never reuse numbers from tool descriptions or examples/i)
    assert.match(r, /EACH change/i)
    assert.match(r, /say so plainly/i)
    assert.match(r, /Never claim it is applied before Confirm/i)
  })

  it('keeps short asks from turning into workouts and definitions into essays', () => {
    assert.match(
      buildCoachTurnReminder(inferCoachIntent('Bench?')),
      /Do NOT output a workout/i,
    )
    assert.match(
      buildCoachTurnReminder(inferCoachIntent('Should I train today?')),
      /First sentence = the decision/i,
    )
    assert.match(
      buildCoachTurnReminder(inferCoachIntent('What does RIR mean?')),
      /2–3 sentences of plain prose/i,
    )
    assert.match(
      buildCoachTurnReminder(inferCoachIntent('Dumbbell bench vs barbell bench')),
      /Compare like for like/i,
    )
  })

  it('uses different reminders so the model is steered by intent, not one template', () => {
    const definition = buildCoachTurnReminder(inferCoachIntent('What is RIR?'))
    const workout = buildCoachTurnReminder(inferCoachIntent('Give me a leg workout.'))
    const safety = buildCoachTurnReminder(
      inferCoachIntent('My knee hurts when I squat.'),
    )
    const short = buildCoachTurnReminder(inferCoachIntent('Why?', 'Use 95 lb today.'))

    assert.match(definition, /Intent: definition/i)
    assert.match(definition, /plain prose/i)
    assert.match(workout, /executable workout/i)
    assert.match(workout, /unspecified → flex/i)
    assert.match(workout, /Never mention auto-start/i)
    assert.match(safety, /safety/i)
    assert.match(short, /short follow-up/i)

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
  it('shapes the reply from the ask instead of one template', () => {
    assert.match(COACH_SYSTEM_PROMPT, /Simple question = simple answer/i)
    assert.match(COACH_SYSTEM_PROMPT, /Deliver the shape they ask for/i)
    assert.match(COACH_SYSTEM_PROMPT, /Simple answers are plain prose/i)
  })
})
