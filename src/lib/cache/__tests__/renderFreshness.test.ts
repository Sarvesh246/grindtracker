import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRenderStale, RENDER_STALE_AFTER_MS } from '../renderFreshness'

const NOW = Date.UTC(2026, 10, 16, 8, 0, 0)

test('a render from a moment ago is trusted', () => {
  assert.equal(isRenderStale(NOW - 2_000, NOW), false)
})

test("yesterday's saved screen is stale — the morning-after-a-workout case", () => {
  assert.equal(isRenderStale(NOW - 20 * 60 * 60 * 1000, NOW), true)
})

test('a payload the client router would still reuse is not refetched', () => {
  assert.equal(isRenderStale(NOW - (RENDER_STALE_AFTER_MS - 1_000), NOW), false)
})

test('just past the window is stale', () => {
  assert.equal(isRenderStale(NOW - (RENDER_STALE_AFTER_MS + 1_000), NOW), true)
})

test('a device clock behind the server never reads as stale', () => {
  assert.equal(isRenderStale(NOW + 90_000, NOW), false)
})
