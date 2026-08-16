import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeLocalIsPR,
  liveSetIsPR,
  normalizePriorVolume,
  emptySetState,
  mergeSessionExercises,
  parseSessionExtraIds,
} from '../../../app/(app)/log/sessionLogState'

describe('normalizePriorVolume', () => {
  it('treats null / undefined / empty as no prior (first lift)', () => {
    assert.equal(normalizePriorVolume(null), null)
    assert.equal(normalizePriorVolume(undefined), null)
    assert.equal(normalizePriorVolume(''), null)
  })

  it('coerces PostgREST numeric strings', () => {
    assert.equal(normalizePriorVolume('960'), 960)
    assert.equal(normalizePriorVolume('960.0'), 960)
  })

  it('rejects non-numeric junk', () => {
    assert.equal(normalizePriorVolume('nope'), null)
    assert.equal(normalizePriorVolume(NaN), null)
  })
})

describe('computeLocalIsPR', () => {
  it('matches grind_recompute_stats: first lift (null prior) is the baseline, not a PR', () => {
    assert.equal(computeLocalIsPR(false, 80, 12, null), false)
  })

  it('treats undefined prior like null — first lift is not a PR', () => {
    assert.equal(computeLocalIsPR(false, 80, 12, undefined), false)
  })

  it('treats numeric strings from get_exercise_bests as numbers', () => {
    assert.equal(computeLocalIsPR(false, 80, 12, '900'), true)
    assert.equal(computeLocalIsPR(false, 80, 12, '960'), false)
  })

  it('requires beating the prior volume, not matching it', () => {
    assert.equal(computeLocalIsPR(false, 80, 12, 960), false)
    assert.equal(computeLocalIsPR(false, 80, 13, 960), true)
  })

  it('excludes warm-ups', () => {
    assert.equal(computeLocalIsPR(true, 80, 12, null), false)
  })

  it('excludes missing weight', () => {
    assert.equal(computeLocalIsPR(false, null, 12, null), false)
  })
})

describe('liveSetIsPR', () => {
  it('shows the reps badge on a checked working set that beats the baseline', () => {
    const entry = { ...emptySetState('80'), reps: '12', checked: true }
    assert.equal(liveSetIsPR(entry, 900), true)
    assert.equal(liveSetIsPR(entry, 960), false)
  })

  it('hides the badge on the first lift (no prior baseline)', () => {
    const entry = { ...emptySetState('80'), reps: '12', checked: true }
    assert.equal(liveSetIsPR(entry, null), false)
  })

  it('hides the badge on skipped / unchecked / warmup rows', () => {
    const base = { ...emptySetState('80'), reps: '12', checked: true }
    assert.equal(liveSetIsPR({ ...base, skipped: true }, 900), false)
    assert.equal(liveSetIsPR({ ...base, checked: false }, 900), false)
    assert.equal(liveSetIsPR({ ...base, isWarmup: true }, 900), false)
  })

  it('still badges later sets against the prior-session baseline (not raised mid-session)', () => {
    const set2 = { ...emptySetState('80'), reps: '12', checked: true }
    // Set 1 already logged 80×12 this session; baseline stays the old 900.
    assert.equal(liveSetIsPR(set2, 900), true)
  })
})

describe('mergeSessionExercises', () => {
  it('appends catalog rows that have logs but are not on this day', () => {
    const day = [{ id: 'a' }, { id: 'b' }]
    const catalog = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
    const merged = mergeSessionExercises(day, catalog, ['c', 'a', 'missing'])
    assert.deepEqual(merged.map(e => e.id), ['a', 'b', 'c'])
  })

  it('returns the same array when there is nothing extra', () => {
    const day = [{ id: 'a' }]
    const catalog = [{ id: 'a' }, { id: 'b' }]
    const merged = mergeSessionExercises(day, catalog, ['a'])
    assert.equal(merged, day)
  })
})

describe('parseSessionExtraIds', () => {
  it('reads a JSON string array and drops junk', () => {
    assert.deepEqual(parseSessionExtraIds('["a","b",""]'), ['a', 'b'])
    assert.deepEqual(parseSessionExtraIds('[1,"c",null]'), ['c'])
  })

  it('returns empty for missing or invalid values', () => {
    assert.deepEqual(parseSessionExtraIds(null), [])
    assert.deepEqual(parseSessionExtraIds(''), [])
    assert.deepEqual(parseSessionExtraIds('{nope}'), [])
    assert.deepEqual(parseSessionExtraIds('"x"'), [])
  })
})
