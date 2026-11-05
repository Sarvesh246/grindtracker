import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getClientUser, makeTimeoutFetch } from '../client'

/** A fetch that never answers unless its signal aborts — a hung request. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true })
  })

test('a hung REST request rejects at the timeout instead of hanging forever', async () => {
  const f = makeTimeoutFetch(20, hangingFetch)
  await assert.rejects(
    f('https://x.supabase.co/rest/v1/sessions'),
    (err: unknown) => err instanceof DOMException && err.name === 'TimeoutError',
  )
})

test('storage uploads are not cut off by the timeout', async () => {
  let sawSignal = true
  const f = makeTimeoutFetch(5, async (_input, init) => {
    sawSignal = !!init?.signal
    await new Promise(r => setTimeout(r, 20))
    return new Response('ok')
  })
  const res = await f('https://x.supabase.co/storage/v1/object/photos/a.jpg', {})
  assert.equal(await res.text(), 'ok')
  assert.equal(sawSignal, false)
})

test('a caller abort still propagates through the timeout wrapper', async () => {
  const f = makeTimeoutFetch(10_000, hangingFetch)
  const ac = new AbortController()
  const p = f('https://x.supabase.co/rest/v1/sessions', { signal: ac.signal })
  ac.abort(new Error('cancelled'))
  await assert.rejects(p, /cancelled/)
})

function fakeAuth(opts: { session?: unknown; user?: unknown; onGetUser?: () => void }) {
  return {
    auth: {
      getSession: async () => ({ data: { session: opts.session ?? null } }),
      getUser: async () => {
        opts.onGetUser?.()
        return { data: { user: opts.user ?? null } }
      },
    },
  } as unknown as SupabaseClient
}

test('getClientUser reads the local session without a network getUser', async () => {
  let networkCalls = 0
  const user = await getClientUser(
    fakeAuth({ session: { user: { id: 'u1' } }, onGetUser: () => networkCalls++ }),
  )
  assert.equal(user?.id, 'u1')
  assert.equal(networkCalls, 0)
})

test('getClientUser falls back to getUser when there is no local session', async () => {
  const user = await getClientUser(fakeAuth({ user: { id: 'u2' } }))
  assert.equal(user?.id, 'u2')
})

test('getClientUser returns null when signed out', async () => {
  assert.equal(await getClientUser(fakeAuth({})), null)
})
