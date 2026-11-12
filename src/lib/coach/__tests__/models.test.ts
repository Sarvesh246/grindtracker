import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  COACH_AUTO_MODEL,
  COACH_MODEL_GROUPS,
  COACH_MODELS,
  coachModelSettings,
  resolveCoachModelChain,
} from '../models'

const ids = COACH_MODELS.map(m => m.id)

test('auto starts on the default model, then every other model once', () => {
  const chain = resolveCoachModelChain(COACH_AUTO_MODEL, ids[0])
  assert.equal(chain[0], ids[0])
  assert.deepEqual([...chain].sort(), [...ids].sort())
})

test('a picked model goes first and still falls back to the rest', () => {
  const picked = ids[ids.length - 1]
  const chain = resolveCoachModelChain(picked, ids[0])
  assert.equal(chain[0], picked)
  assert.equal(chain.length, ids.length)
  assert.equal(new Set(chain).size, chain.length)
})

test('an unknown model id from the client is treated as auto', () => {
  const chain = resolveCoachModelChain('gpt-9-ultra', ids[0])
  assert.equal(chain[0], ids[0])
  assert.ok(!chain.includes('gpt-9-ultra'))
})

test('every listed model belongs to a menu group', () => {
  const groups = new Set(COACH_MODEL_GROUPS.map(g => g.id))
  for (const m of COACH_MODELS) assert.ok(groups.has(m.group), m.id)
})

test('Gemma never gets a thinking config; Gemini 3 keeps default temperature', () => {
  assert.equal(coachModelSettings('gemma-4-26b-a4b-it').supportsReasoning, false)
  assert.equal(coachModelSettings('gemini-3.5-flash-lite').temperature, undefined)
})
