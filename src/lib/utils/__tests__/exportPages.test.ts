import assert from 'node:assert/strict'
import { it } from 'node:test'
import { exportPages } from '../exportPages'

it('exports every row across a response cap, preserving stable order', async () => {
  const fixture = Array.from({ length: 1_237 }, (_, index) => ({ id: index }))
  const rows = await exportPages(async (from, to) => ({
    count: fixture.length,
    data: fixture.slice(from, Math.min(to + 1, from + 175)),
    error: null,
  }))
  assert.deepEqual(rows, fixture)
})

it('fails export on a refused page or an inconsistent count', async () => {
  await assert.rejects(exportPages(async from => from === 0
    ? { data: [1], count: 2, error: null }
    : { data: null, count: null, error: new Error('read failed') }), /read failed/)
  await assert.rejects(exportPages(async from => ({
    data: [from], count: from === 0 ? 2 : 1, error: null,
  })), /count changed/)
})
