import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { groundingReasonFor, numbersInText } from '../actions/grounding'
import { planSetDayEnabled } from '../actions/setDayEnabled'
import { localizeCoachContext } from '../localizeUnits'
import { formatRecentActions } from '../recentActions'
import { planCoachTurn, trimToLastSentence } from '../turn'
import { formatCoachMessage } from '../formatMessage'
import { weekdayName } from '../buildContext'

describe('argument grounding (never rewrite history on a guess)', () => {
  it('reads numbers written in digits', () => {
    assert.deepEqual(numbersInText('bench was 135 not 125, maybe 82.5 kg or 1,000'), [135, 125, 82.5, 1000])
  })

  it('refuses a correction whose numbers the user never gave (the D8 failure)', () => {
    const reason = groundingReasonFor(
      'propose_correct_weights',
      { exerciseName: 'Bench Press', fromWeight: 90, toWeight: 95 },
      'Fix my bench numbers.',
    )
    assert.ok(reason)
    assert.match(reason!, /Do not guess/i)
    assert.match(reason!, /Ask ONE short question/i)
  })

  it('accepts a correction when both numbers are in what the user said', () => {
    assert.equal(
      groundingReasonFor(
        'propose_correct_weights',
        { fromWeight: 125, toWeight: 135 },
        'That bench was 135 not 125 on all my sessions',
      ),
      null,
    )
  })

  it('lets a number arrive across turns ("which weight?" … "125 to 135")', () => {
    assert.equal(
      groundingReasonFor(
        'propose_correct_weights',
        { fromWeight: 125, toWeight: 135 },
        'fix my bench numbers\n125 to 135',
      ),
      null,
    )
  })

  it('guards body weight and set edits, and nothing else', () => {
    assert.ok(groundingReasonFor('propose_log_body_weight', { weight: 180 }, 'log my weight'))
    assert.equal(groundingReasonFor('propose_log_body_weight', { weight: 181.4 }, 'weighed 181.4 today'), null)
    assert.ok(groundingReasonFor('propose_edit_session_log', { reps: 8 }, 'that set was wrong'))
    assert.equal(groundingReasonFor('propose_edit_session_log', { rpe: 9 }, 'RPE was 9'), null)
    // Unguarded tools and a missing user text never block.
    assert.equal(groundingReasonFor('propose_edit_exercise', { sets_target: 5 }, 'add a set'), null)
    assert.equal(groundingReasonFor('propose_correct_weights', { fromWeight: 1, toWeight: 2 }, undefined), null)
  })
})

describe('planSetDayEnabled (hide / show a whole day)', () => {
  const rows = [
    { day_type: 'push 2', active: true },
    { day_type: 'push 2', active: true },
    { day_type: 'abs', active: false },
    { day_type: 'abs', active: false },
    { day_type: 'pull', active: true },
    { day_type: 'pull', active: false },
  ]

  it('hides a day however the user worded it', () => {
    const plan = planSetDayEnabled(rows, 'Push 2 workout day', false)
    assert.equal(plan.ok, true)
    if (plan.ok) {
      assert.equal(plan.dayType, 'push 2')
      assert.equal(plan.total, 2)
    }
  })

  it('refuses no-ops and unknown days with a useful reason', () => {
    const already = planSetDayEnabled(rows, 'abs', false)
    assert.equal(already.ok, false)
    const showing = planSetDayEnabled(rows, 'push 2', true)
    assert.equal(showing.ok, false)
    const unknown = planSetDayEnabled(rows, 'neck', false)
    assert.equal(unknown.ok, false)
    if (!unknown.ok) assert.match(unknown.reason, /Your days: .*abs/)
  })

  it('shows a half-hidden day and a fully hidden one', () => {
    assert.equal(planSetDayEnabled(rows, 'pull', true).ok, true)
    assert.equal(planSetDayEnabled(rows, 'abs', true).ok, true)
  })
})

describe('localizeCoachContext (exact unit conversion, not model arithmetic)', () => {
  const ctx = {
    weight_storage: 'lbs',
    lifetime: { total_volume_lbs: 220462, max_set_weight_lbs: 220.462 },
    recent: [{ weight_lbs: 176.37, reps: 8, name: 'Bench' }],
    untouched: { reps: 5 },
  }

  it('leaves lbs users completely alone', () => {
    assert.equal(localizeCoachContext(ctx, 'lbs'), ctx)
  })

  it('converts every *_lbs number for kg users and renames the key', () => {
    const out = localizeCoachContext(ctx, 'kg') as unknown as {
      weight_storage: string
      lifetime: Record<string, number>
      recent: { weight_kg: number; reps: number }[]
      untouched: { reps: number }
    }
    assert.equal(out.weight_storage, 'kg')
    assert.equal(out.lifetime.max_set_weight_kg, 100)
    assert.equal(out.lifetime.total_volume_kg, 100000)
    assert.equal(out.recent[0].weight_kg, 80)
    assert.equal(out.recent[0].reps, 8)
    assert.equal(out.untouched.reps, 5)
    assert.equal('max_set_weight_lbs' in out.lifetime, false)
  })
})

describe('formatRecentActions', () => {
  const now = Date.parse('2026-11-09T12:00:00Z')

  it('is null with nothing to say', () => {
    assert.equal(formatRecentActions([], now), null)
  })

  it('states what happened to each card, and that pending is not applied', () => {
    const text = formatRecentActions(
      [
        {
          kind: 'edit_exercise',
          status: 'executed',
          created_at: '2026-11-09T11:50:00Z',
          expires_at: '2026-11-09T12:20:00Z',
          payload: { card: { title: 'Edit exercise', summaryLines: ['Barbell Bench Press · push 2', 'Sets: 4 → 5'] } },
        },
        {
          kind: 'edit_exercise',
          status: 'pending',
          created_at: '2026-11-09T11:58:00Z',
          expires_at: '2026-11-09T12:28:00Z',
          payload: { card: { title: 'Edit exercise', summaryLines: ['Sets: 5 → 4'] } },
        },
        {
          kind: 'log_body_weight',
          status: 'cancelled',
          created_at: '2026-11-09T11:00:00Z',
          expires_at: '2026-11-09T11:30:00Z',
          payload: { card: { title: 'Log body weight', summaryLines: ['180 lb'] } },
        },
      ],
      now,
    )!
    assert.match(text, /10 min ago · Edit exercise · applied — Barbell Bench Press · push 2; Sets: 4 → 5/)
    assert.match(text, /PENDING — not applied yet — Sets: 5 → 4/)
    assert.match(text, /cancelled by the user — not applied/)
  })

  it('calls a stale pending card expired, not pending', () => {
    const text = formatRecentActions(
      [
        {
          kind: 'create_day',
          status: 'pending',
          created_at: '2026-11-09T10:00:00Z',
          expires_at: '2026-11-09T10:30:00Z',
          payload: { card: { title: 'Create workout day', summaryLines: [] } },
        },
      ],
      now,
    )!
    assert.match(text, /expired — not applied/)
    assert.doesNotMatch(text, /PENDING/)
  })
})

describe('planCoachTurn', () => {
  const base = { history: [], userDataJson: '{}', recentActions: null }

  it('keeps tools off pure Q&A and on for everything that could be a change', () => {
    assert.equal(planCoachTurn({ ...base, message: 'What does RIR mean?' }).toolsEnabled, false)
    assert.equal(planCoachTurn({ ...base, message: 'Skip the last set of bench' }).toolsEnabled, true)
    assert.equal(planCoachTurn({ ...base, message: 'sort my week out please' }).toolsEnabled, true)
  })

  it('thinks only where consistency matters', () => {
    assert.equal(planCoachTurn({ ...base, message: 'Should I increase the weight?' }).reasoning, 'low')
    assert.equal(planCoachTurn({ ...base, message: 'Bench?' }).reasoning, 'none')
    assert.equal(planCoachTurn({ ...base, message: 'Log 180 and rest today' }).reasoning, 'none')
  })

  it('covers an unanswered earlier ask: its budget, tools and the merged turn', () => {
    const plan = planCoachTurn({
      ...base,
      history: [{ role: 'user', content: 'Give me a leg workout.' }],
      message: 'What does RIR mean?',
    })
    assert.equal(plan.toolsEnabled, true)
    assert.ok(plan.maxOutputTokens >= 1400)
    assert.equal(plan.messages.length, 1)
  })

  it('hands the grounding check the last few things the user typed', () => {
    const plan = planCoachTurn({
      ...base,
      history: [
        { role: 'user', content: 'fix my bench numbers' },
        { role: 'assistant', content: 'Which weight is wrong?' },
      ],
      message: '125 to 135',
    })
    assert.match(plan.userText, /fix my bench numbers/)
    assert.match(plan.userText, /125 to 135/)
  })

  it('puts the intent reminder and recent actions in the system prompt', () => {
    const plan = planCoachTurn({
      ...base,
      recentActions: '- just now · Edit exercise · PENDING — not applied yet',
      message: 'make that 4 sets',
    })
    assert.match(plan.system, /<recent_actions>/)
    assert.match(plan.system, /<this_turn>/)
  })
})

describe('trimToLastSentence', () => {
  it('cuts a truncated reply back to a whole sentence', () => {
    assert.equal(
      trimToLastSentence('Use 95 lb today. You hit all four sets last time and the next step is to'),
      'Use 95 lb today.',
    )
  })

  it('leaves a clean ending, and a reply with no good cut point, alone', () => {
    assert.equal(trimToLastSentence('Use 95 lb today.'), 'Use 95 lb today.')
    assert.equal(trimToLastSentence('No punctuation here at all'), 'No punctuation here at all')
  })
})

describe('workout stacks only for workout-shaped detail (the faded-advice bug)', () => {
  it('renders advice after a bold lead-in as a title over a NORMAL paragraph', () => {
    const blocks = formatCoachMessage(
      '**How to deload:**\nCut your working volume in half while keeping the weights the same, or reduce your working weights by about 10–20% for one week.',
    )
    assert.deepEqual(blocks.map(b => b.type), ['title', 'paragraph'])
  })

  it('still builds a stack for a real exercise block', () => {
    const blocks = formatCoachMessage('**Barbell Squat**\n4 × 6–8\nTarget: **70 lb**\nRest: 2–3 min')
    assert.deepEqual(blocks.map(b => b.type), ['stack'])
  })

  it('never fades a heading even when its text mentions sets', () => {
    const blocks = formatCoachMessage('**Plan for this week:**\nDo 3 sets of 8 on each lift.')
    assert.deepEqual(blocks.map(b => b.type), ['title', 'paragraph'])
  })
})

describe('weekdayName', () => {
  it('gives the model the weekday instead of making it work one out', () => {
    assert.equal(weekdayName('2026-11-09'), 'Monday')
    assert.equal(weekdayName('2026-11-10'), 'Tuesday')
    assert.equal(weekdayName('not-a-date'), '')
  })
})
