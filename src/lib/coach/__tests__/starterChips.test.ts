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

  it('falls back to generic chips', () => {
    const chips = coachStarterChips({})
    assert.equal(chips[0], "How's my streak?")
    assert.equal(chips.length, 4)
  })
})
