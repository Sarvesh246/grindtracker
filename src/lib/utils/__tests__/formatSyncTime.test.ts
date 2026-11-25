import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { formatSyncTime } from '../formatting'

// Built from local components so the test holds in any timezone.
const now = new Date(2026, 10, 25, 20, 0)

describe('formatSyncTime', () => {
  it('shows only the time for today, without seconds', () => {
    const out = formatSyncTime(new Date(2026, 10, 25, 17, 3, 52), now)
    assert.match(out, /^5:03\sPM$/)
  })

  it('labels yesterday', () => {
    assert.match(formatSyncTime(new Date(2026, 10, 24, 9, 5), now), /^Yesterday, 9:05\sAM$/)
  })

  it('uses a short month date this year and adds the year otherwise', () => {
    assert.match(formatSyncTime(new Date(2026, 10, 20, 9, 5), now), /^Nov 20, 9:05\sAM$/)
    assert.match(formatSyncTime(new Date(2025, 0, 2, 9, 5), now), /^Jan 2, 2025, 9:05\sAM$/)
  })

  it('accepts epoch milliseconds and ignores garbage', () => {
    assert.match(formatSyncTime(new Date(2026, 10, 25, 8, 0).getTime(), now), /^8:00\sAM$/)
    assert.equal(formatSyncTime('not a date', now), '')
  })
})
