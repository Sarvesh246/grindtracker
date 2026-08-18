import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readLastKnownStats, writeLastKnownStats, clearLastKnownStats } from '../lastKnownStats'
import type { UserStats } from '@/lib/types'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  globalThis.window = {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v) },
      removeItem: (k: string) => { store.delete(k) },
    },
  } as unknown as Window & typeof globalThis
})

const STATS = {
  user_id: 'user-a',
  xp_total: 4200,
  level: 4,
  current_streak: 6,
  longest_streak: 11,
  last_workout_date: '2026-08-17',
  total_workouts: 42,
} as unknown as UserStats

const DAY = 24 * 60 * 60 * 1000

describe('lastKnownStats', () => {
  it('round-trips the stats it stored', () => {
    writeLastKnownStats('user-a', STATS)
    assert.deepEqual(readLastKnownStats('user-a'), STATS)
  })

  it('returns null when nothing was ever stored', () => {
    assert.equal(readLastKnownStats('user-a'), null)
  })

  // A shared device must never paint one account's level/streak for another.
  it('refuses stats belonging to a different user', () => {
    writeLastKnownStats('user-a', STATS)
    assert.equal(readLastKnownStats('user-b'), null)
  })

  it('expires entries older than the max age', () => {
    const now = Date.now()
    writeLastKnownStats('user-a', STATS, now - 31 * DAY)
    assert.equal(readLastKnownStats('user-a', now), null)
    writeLastKnownStats('user-a', STATS, now - 29 * DAY)
    assert.deepEqual(readLastKnownStats('user-a', now), STATS)
  })

  it('survives corrupt storage without throwing', () => {
    store.set('grind_last_stats', '{not json')
    assert.equal(readLastKnownStats('user-a'), null)
  })

  it('clears on sign-out', () => {
    writeLastKnownStats('user-a', STATS)
    clearLastKnownStats()
    assert.equal(readLastKnownStats('user-a'), null)
  })
})
