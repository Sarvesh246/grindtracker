import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { receivedText, stepCurve } from '../intraday'

const at = (pairs: [number, number][]) => {
  const out: (number | null)[] = new Array(96).fill(null)
  for (const [i, v] of pairs) out[i] = v
  return out
}

describe('stepCurve', () => {
  it('draws from 0 at midnight straight to each sync, and stops at the last one', () => {
    const c = stepCurve(at([[4, 400], [8, 400], [12, 1200]]))
    assert.equal(c[0], 0)
    assert.equal(c[2], 200)
    assert.equal(c[4], 400)
    assert.equal(c[6], 400)
    assert.equal(c[10], 800)
    assert.equal(c[12], 1200)
    assert.equal(c[13], null)
  })

  it('ignores a total lower than an earlier one', () => {
    const c = stepCurve(at([[4, 400], [6, 100], [8, 800]]))
    assert.equal(c[6], 600)
  })

  it('is empty with no syncs', () => {
    assert.ok(stepCurve(at([])).every(v => v == null))
  })
})

describe('receivedText', () => {
  it('names the newest sync and how it came, with the day count', () => {
    const t = receivedText([
      { received_at: '2026-11-18T19:14:00Z', source: 'background' },
      { received_at: '2026-11-18T18:59:00Z', source: 'app' },
      { received_at: '2026-11-18T18:44:00Z', source: 'background' },
    ], null)
    assert.match(t, /^Received .+ \(background\) · 3 syncs, 2 in the background$/)
  })

  it('says the app was open for an app sync', () => {
    assert.match(receivedText([{ received_at: '2026-11-18T19:14:00Z', source: 'app' }], null), /\(watch app open\) · 1 sync, 0 in the background$/)
  })

  it('falls back to the row time before the sync log exists, and to nothing', () => {
    assert.match(receivedText([], '2026-11-18T19:14:00Z'), /^Received /)
    assert.equal(receivedText([], null), 'Nothing received for this date')
  })
})
