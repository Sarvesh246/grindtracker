import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  REST_DEFAULT_FRESH_MS,
  applyRestDefaultChange,
  remainingAfterRestDefaultChange,
} from '../restTimerMath'

describe('remainingAfterRestDefaultChange', () => {
  it('keeps 38s when shrinking 90 → 60 (does not reset to 60)', () => {
    assert.equal(remainingAfterRestDefaultChange(38_000, 90_000, 60), 38_000)
  })

  it('keeps 58s when shrinking 90 → 60 (still fits)', () => {
    assert.equal(remainingAfterRestDefaultChange(58_000, 90_000, 60), 58_000)
  })

  it('clamps remaining that no longer fits the new default (70 → 60)', () => {
    assert.equal(remainingAfterRestDefaultChange(70_000, 90_000, 60), 60_000)
  })

  it('does not add time when raising the default mid-rest (40 of 90 → 120)', () => {
    assert.equal(remainingAfterRestDefaultChange(40_000, 90_000, 120), 40_000)
  })

  it('snaps a just-started rest to the new full default (90 → 60)', () => {
    assert.equal(remainingAfterRestDefaultChange(90_000, 90_000, 60), 60_000)
  })

  it('snaps a just-started rest up when they pick a longer default (90 → 180)', () => {
    assert.equal(remainingAfterRestDefaultChange(90_000, 90_000, 180), 180_000)
  })

  it('does not snap once a second has elapsed (89s of 90 → 180 stays 89)', () => {
    assert.equal(
      remainingAfterRestDefaultChange(90_000 - REST_DEFAULT_FRESH_MS, 90_000, 180),
      90_000 - REST_DEFAULT_FRESH_MS,
    )
  })

  it('returns 0 for an already-finished rest', () => {
    assert.equal(remainingAfterRestDefaultChange(0, 90_000, 60), 0)
  })
})

describe('applyRestDefaultChange', () => {
  const now = 1_000_000

  it('rebases a running clock so remaining stays 38s after 90 → 60', () => {
    // 52s elapsed of a 90s rest → 38s left
    const startedAt = now - 52_000
    const next = applyRestDefaultChange({
      remainingMs: 38_000,
      durationMs: 90_000,
      newDefaultSec: 60,
      now,
      startedAt,
      paused: false,
    })
    assert.ok(next)
    assert.equal(next.remainingMs, 38_000)
    assert.equal(next.durationMs, 60_000)
    assert.equal(next.startedAt, now - (60_000 - 38_000))
    assert.equal(next.durationMs - (now - next.startedAt), 38_000)
  })

  it('rebases a running clock so remaining stays 58s after 90 → 60', () => {
    const startedAt = now - 32_000
    const next = applyRestDefaultChange({
      remainingMs: 58_000,
      durationMs: 90_000,
      newDefaultSec: 60,
      now,
      startedAt,
      paused: false,
    })
    assert.ok(next)
    assert.equal(next.remainingMs, 58_000)
    assert.equal(next.durationMs, 60_000)
    assert.equal(next.durationMs - (now - next.startedAt), 58_000)
  })

  it('clamps a running rest that is still above the new default', () => {
    const startedAt = now - 20_000
    const next = applyRestDefaultChange({
      remainingMs: 70_000,
      durationMs: 90_000,
      newDefaultSec: 60,
      now,
      startedAt,
      paused: false,
    })
    assert.ok(next)
    assert.equal(next.remainingMs, 60_000)
    assert.equal(next.durationMs, 60_000)
    assert.equal(next.startedAt, now)
  })

  it('preserves a paused remaining time (does not resume or reset)', () => {
    const next = applyRestDefaultChange({
      remainingMs: 38_000,
      durationMs: 90_000,
      newDefaultSec: 60,
      now,
      startedAt: now - 52_000,
      paused: true,
    })
    assert.ok(next)
    assert.equal(next.remainingMs, 38_000)
    assert.equal(next.durationMs, 60_000)
    assert.equal(next.startedAt, now - 52_000)
  })

  it('ignores a rest that has already hit 0', () => {
    assert.equal(
      applyRestDefaultChange({
        remainingMs: 0,
        durationMs: 90_000,
        newDefaultSec: 60,
        now,
        startedAt: now - 90_000,
        paused: false,
      }),
      null,
    )
  })

  it('uses live remaining, not a stale tick, when running', () => {
    // State still says 40s but 5s have passed since the last 250ms tick.
    const startedAt = now - 55_000
    const next = applyRestDefaultChange({
      remainingMs: 40_000,
      durationMs: 90_000,
      newDefaultSec: 60,
      now,
      startedAt,
      paused: false,
    })
    assert.ok(next)
    assert.equal(next.remainingMs, 35_000)
  })
})
