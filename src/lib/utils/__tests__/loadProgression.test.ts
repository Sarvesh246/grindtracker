import assert from 'node:assert/strict'
import { it } from 'node:test'
import { getLoadSuggestion } from '../loadProgression'

const plan = { id: 'row', name: 'Row', sets_target: 3, reps_target: '8-12', weight_target: 70 }
const sets = [12, 13, 12].map((reps, index) => ({
  set_number: index + 1, reps, weight: 70, is_skipped: false,
}))

it('uses the full list of working reps once all sets hit the range ceiling', () => {
  assert.deepEqual(getLoadSuggestion(plan, [sets[2], sets[0], sets[1]])?.reps, [12, 13, 12])
})

it('skips incomplete work, mixed loads and plans the user already changed', () => {
  assert.equal(getLoadSuggestion(plan, sets.slice(0, 2)), null)
  assert.equal(getLoadSuggestion(plan, [...sets.slice(0, 2), { ...sets[2], is_skipped: true }]), null)
  assert.equal(getLoadSuggestion(plan, [...sets.slice(0, 2), { ...sets[2], reps: 11 }]), null)
  assert.equal(getLoadSuggestion(plan, [...sets.slice(0, 2), { ...sets[2], weight: 75 }]), null)
  assert.equal(getLoadSuggestion({ ...plan, weight_target: 75 }, sets), null)
  assert.equal(getLoadSuggestion({ ...plan, reps_target: '12' }, sets), null)
})
