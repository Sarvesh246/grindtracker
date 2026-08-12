import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeNdjson,
  parseCoachChatStreamLine,
  validateCreateDayInput,
  weightsMatch,
  isProposalExpired,
  fmtWeightForUnit,
} from '../actions'

describe('coach actions helpers', () => {
  it('matches near-equal weights within float noise', () => {
    assert.equal(weightsMatch(90, 90), true)
    assert.equal(weightsMatch(90, 90.04), true)
    assert.equal(weightsMatch(90, 95), false)
  })

  it('formats display weights', () => {
    assert.equal(fmtWeightForUnit(95, 'lb'), '95 lb')
    assert.match(fmtWeightForUnit(220.46, 'kg'), /100 kg/)
  })

  it('detects expired proposals', () => {
    assert.equal(isProposalExpired(new Date(Date.now() - 1000).toISOString()), true)
    assert.equal(
      isProposalExpired(new Date(Date.now() + 60_000).toISOString()),
      false,
    )
  })

  it('validates create-day input', () => {
    const ok = validateCreateDayInput({
      dayKey: 'Upper',
      category: 'push',
      exercises: [
        { name: 'Bench', sets_target: 3, reps_target: '6-8', weight_target_lbs: 95 },
      ],
    })
    assert.equal(ok.ok, true)
    if (ok.ok) {
      assert.equal(ok.dayKey, 'upper')
      assert.equal(ok.category, 'push')
      assert.equal(ok.exercises[0]!.name, 'Bench')
    }

    const bad = validateCreateDayInput({
      dayKey: '',
      exercises: [],
    })
    assert.equal(bad.ok, false)

    const collide = validateCreateDayInput({
      dayKey: 'push!!!',
      exercises: [{ name: 'A', sets_target: 3, reps_target: '8' }],
    })
    assert.equal(collide.ok, false)
  })

  it('encodes and parses NDJSON chat stream lines', () => {
    const line = encodeNdjson({ type: 'text-delta', text: 'Hi' })
    assert.equal(line.endsWith('\n'), true)
    const parsed = parseCoachChatStreamLine(line)
    assert.deepEqual(parsed, { type: 'text-delta', text: 'Hi' })

    const proposal = parseCoachChatStreamLine(
      JSON.stringify({
        type: 'proposal',
        proposal: {
          id: 'p1',
          kind: 'start_workout',
          status: 'pending',
          card: { title: 'Start', summaryLines: ['push'] },
          expiresAt: new Date().toISOString(),
        },
      }),
    )
    assert.equal(proposal?.type, 'proposal')

    // Legacy plain text fallback
    const plain = parseCoachChatStreamLine('hello world')
    assert.deepEqual(plain, { type: 'text-delta', text: 'hello world' })
  })
})
