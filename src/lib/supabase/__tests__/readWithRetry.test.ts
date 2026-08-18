import test from 'node:test'
import assert from 'node:assert/strict'
import { readWithRetry } from '../readWithRetry'

/** reportError always console.errors; keep the test output readable. */
function quiet<T>(run: () => Promise<T>): Promise<T> {
  const original = console.error
  console.error = () => {}
  return run().finally(() => {
    console.error = original
  })
}

test('returns the first result without retrying when the read succeeds', async () => {
  let calls = 0
  const result = await readWithRetry('t', async () => {
    calls++
    return { data: { total_workouts: 12 }, error: null }
  })
  assert.equal(calls, 1)
  assert.deepEqual(result.data, { total_workouts: 12 })
})

test('retries once when the read errors, and keeps the recovered data', async () => {
  let calls = 0
  const result = await readWithRetry(
    't',
    async () => {
      calls++
      return calls === 1
        ? { data: null, error: { message: 'connection reset' } }
        : { data: { total_workouts: 12 }, error: null }
    },
    { delayMs: 0 },
  )
  assert.equal(calls, 2)
  assert.equal(result.error, null)
  assert.deepEqual(result.data, { total_workouts: 12 })
})

test('gives up after the attempt budget and reports the last failure', async () => {
  let calls = 0
  const result = await quiet(() =>
    readWithRetry(
      't',
      async () => {
        calls++
        return { data: null, error: { message: 'still down' } }
      },
      { delayMs: 0 },
    ),
  )
  assert.equal(calls, 2)
  assert.deepEqual(result.error, { message: 'still down' })
})

// The bug this guards: `user_stats` is seeded for every account at signup, so a
// null row is a failed read, not a brand-new user. Without the `failed`
// predicate it looks like a clean success and renders as a reset account.
test('a custom failed() predicate retries an error-free but impossible result', async () => {
  let calls = 0
  const result = await readWithRetry(
    't',
    async () => {
      calls++
      return calls === 1
        ? { data: null, error: null }
        : { data: { current_streak: 9 }, error: null }
    },
    { delayMs: 0, failed: r => r.error != null || r.data == null },
  )
  assert.equal(calls, 2)
  assert.deepEqual(result.data, { current_streak: 9 })
})

test('honors a larger attempt budget', async () => {
  let calls = 0
  await quiet(() =>
    readWithRetry(
      't',
      async () => {
        calls++
        return { data: null, error: { message: 'down' } }
      },
      { delayMs: 0, attempts: 4 },
    ),
  )
  assert.equal(calls, 4)
})
