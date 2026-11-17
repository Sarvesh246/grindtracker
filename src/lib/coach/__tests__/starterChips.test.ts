import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { coachStarterChips } from '../starterChips'

describe('coachStarterChips', () => {
  it('uses workout chips when inWorkout', () => {
    const chips = coachStarterChips({ inWorkout: true })
    assert.deepEqual(chips, [
      'Weight for this set?',
      'What to skip?',
      "How's this session going?",
    ])
  })

  it('uses workout chips when hasActiveSession', () => {
    const chips = coachStarterChips({
      hasActiveSession: true,
      nextDay: 'push',
      lastPrExercise: 'Bench',
    })
    assert.ok(chips[0]?.includes('Weight'))
    assert.equal(chips.length, 3)
  })

  it('prefers next day and last PR over generic-only', () => {
    const chips = coachStarterChips({
      nextDay: 'pull',
      lastPrExercise: 'Deadlift',
    })
    assert.ok(chips.some(c => /pull/i.test(c)))
    assert.ok(chips.some(c => /Deadlift/i.test(c)))
    assert.ok(chips.length <= 4)
    assert.ok(chips.length >= 2)
  })

  it('offers a lighter day first when Charge is under 50', () => {
    const chips = coachStarterChips({ nextDay: 'legs', chargeScore: 42 })
    assert.equal(chips[0], 'Lighter version of today?')
    assert.ok(!chips.includes('Go for a PR today?'))
    assert.ok(chips.length <= 4)
  })

  it('offers a PR attempt first when Charge is over 80', () => {
    const chips = coachStarterChips({ nextDay: 'legs', chargeScore: 86 })
    assert.equal(chips[0], 'Go for a PR today?')
    assert.ok(!chips.includes('Lighter version of today?'))
  })

  it('leaves the chips unchanged for a middling, missing or edge Charge', () => {
    const plain = coachStarterChips({ nextDay: 'legs', lastPrExercise: 'Bench' })
    for (const chargeScore of [50, 65, 80, null, undefined]) {
      assert.deepEqual(coachStarterChips({ nextDay: 'legs', lastPrExercise: 'Bench', chargeScore }), plain)
    }
  })

  it('keeps workout chips mid-session whatever the Charge', () => {
    assert.deepEqual(coachStarterChips({ inWorkout: true, chargeScore: 30 }), coachStarterChips({ inWorkout: true }))
  })

  it('falls back to generic chips', () => {
    const chips = coachStarterChips({})
    assert.equal(chips[0], "How's my streak?")
    assert.equal(chips.length, 4)
  })
})
