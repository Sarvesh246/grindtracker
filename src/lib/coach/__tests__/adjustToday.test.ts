import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  adjustTodayCard,
  executeAdjustToday,
  lighterWeightLbs,
  planAdjustToday,
  validateAdjustTodayInput,
} from '../actions/adjustToday'
import type { AdjustTodayExecutePayload } from '../actions/types'

const EXERCISES = [
  { id: 'bench', name: 'Barbell Bench Press', sets_target: 4, weight_target: 135 },
  { id: 'incline', name: 'Incline Dumbbell Press', sets_target: 3, weight_target: null },
  { id: 'raise', name: 'Lateral Raise', sets_target: 1, weight_target: 10 },
  { id: 'dips', name: 'Dips', sets_target: 3, weight_target: null },
]

describe('validateAdjustTodayInput', () => {
  it('needs a known mode and, for scaling, a sane percent', () => {
    assert.equal(validateAdjustTodayInput({ mode: 'drop_last_set' }).ok, true)
    assert.equal(validateAdjustTodayInput({ mode: 'nope' }).ok, false)
    assert.equal(validateAdjustTodayInput({ mode: 'scale_weights' }).ok, false)
    assert.equal(validateAdjustTodayInput({ mode: 'scale_weights', percent: 60 }).ok, false)
    assert.deepEqual(validateAdjustTodayInput({ mode: 'scale_weights', percent: 10 }), { ok: true, mode: 'scale_weights', percent: 10 })
  })
})

describe('planAdjustToday', () => {
  it('drops the last set of each multi-set lift and skips one-set lifts', () => {
    const plan = planAdjustToday({ mode: 'drop_last_set', percent: null, exercises: EXERCISES, takenSets: new Map(), lastWeights: {}, unit: 'lb' })
    assert.ok(plan.ok)
    assert.deepEqual(
      plan.drops.map(d => [d.exerciseId, d.setNumber]),
      [['bench', 4], ['incline', 3], ['dips', 3]],
    )
    assert.ok(plan.lines.includes('Barbell Bench Press: 4 → 3 sets'))
  })

  it('never touches a last set that is already logged', () => {
    const plan = planAdjustToday({
      mode: 'drop_last_set',
      percent: null,
      exercises: EXERCISES,
      takenSets: new Map([['bench', new Set([1, 2, 3, 4])]]),
      lastWeights: {},
      unit: 'lb',
    })
    assert.ok(plan.ok)
    assert.ok(!plan.drops.some(d => d.exerciseId === 'bench'))
  })

  it('scales working weights to loadable numbers and skips bodyweight lifts', () => {
    const plan = planAdjustToday({
      mode: 'scale_weights',
      percent: 10,
      exercises: EXERCISES,
      takenSets: new Map(),
      lastWeights: { incline: 40 },
      unit: 'lb',
    })
    assert.ok(plan.ok)
    assert.deepEqual(
      plan.weights.map(w => [w.exerciseName, w.fromLbs, w.toLbs]),
      [['Barbell Bench Press', 135, 120], ['Incline Dumbbell Press', 40, 35], ['Lateral Raise', 10, 7.5]],
    )
    assert.equal(plan.drops.length, 0)
  })

  it('refuses when there is nothing to trim', () => {
    const plan = planAdjustToday({ mode: 'drop_last_set', percent: null, exercises: [EXERCISES[2]!], takenSets: new Map(), lastWeights: {}, unit: 'lb' })
    assert.equal(plan.ok, false)
  })
})

describe('lighterWeightLbs', () => {
  it('always lands at least one plate step lighter', () => {
    assert.equal(lighterWeightLbs(100, 5, 'lb'), 95)
    assert.equal(lighterWeightLbs(45, 5, 'lb'), 42.5)
    const kg = lighterWeightLbs(100 * 2.20462, 10, 'kg') / 2.20462
    assert.ok(Math.abs(kg - 90) < 0.01, `${kg}`)
  })
})

describe('adjust_today card', () => {
  const base: AdjustTodayExecutePayload = {
    mode: 'drop_last_set',
    dayType: 'push',
    startsSession: false,
    drops: [],
    percent: null,
    weights: [],
    unitLabel: 'lb',
  }

  it('says it is today only and the plan is untouched', () => {
    const card = adjustTodayCard(base, ['Bench: 4 → 3 sets'])
    assert.match(card.summaryLines.join(' '), /today only/)
    assert.match(card.riskNote ?? '', /saved plan stays as it is/)
  })

  it('is honest that scaling saves nothing', () => {
    const card = adjustTodayCard({ ...base, mode: 'scale_weights', percent: 10 }, ['Bench: 135 lb → 120 lb'])
    assert.match(card.riskNote ?? '', /Nothing is saved/)
  })
})

describe('executeAdjustToday', () => {
  it('scale_weights writes nothing', async () => {
    const client = new Proxy({}, { get: () => () => { throw new Error('should not touch the database') } })
    const r = await executeAdjustToday(client as never, {
      userId: 'u1',
      execute: { mode: 'scale_weights', dayType: 'push', startsSession: false, drops: [], percent: 10, weights: [], unitLabel: 'lb' },
    })
    assert.deepEqual(r, { ok: true, count: 0 })
  })

  it('drop_last_set writes skip markers only, never exercises', async () => {
    const writes: { table: string; rows: unknown; opts: unknown }[] = []
    const tablesRead: string[] = []
    const builder = (table: string) => {
      tablesRead.push(table)
      const self: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'order', 'limit']) self[m] = () => self
      self.maybeSingle = async () => ({ data: { id: 's1' }, error: null })
      self.upsert = async (rows: unknown, opts: unknown) => {
        writes.push({ table, rows, opts })
        return { error: null }
      }
      return self
    }
    const r = await executeAdjustToday({ from: builder } as never, {
      userId: 'u1',
      execute: {
        mode: 'drop_last_set',
        dayType: 'push',
        startsSession: false,
        drops: [{ exerciseId: 'bench', exerciseName: 'Bench', setNumber: 4 }],
        percent: null,
        weights: [],
        unitLabel: 'lb',
      },
    })
    assert.equal(r.ok, true)
    assert.ok(!tablesRead.includes('exercises'))
    assert.equal(writes.length, 1)
    assert.equal(writes[0]!.table, 'session_logs')
    assert.deepEqual((writes[0]!.rows as { is_skipped: boolean; set_number: number }[]).map(x => [x.set_number, x.is_skipped]), [[4, true]])
    assert.deepEqual(writes[0]!.opts, { onConflict: 'session_id,exercise_id,set_number', ignoreDuplicates: true })
  })
})
