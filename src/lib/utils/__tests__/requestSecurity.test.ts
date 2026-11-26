import assert from 'node:assert/strict'
import test from 'node:test'
import { isPushEndpoint, parsePushSubscription } from '@/lib/push/subscription'
import { safeAppPath } from '@/lib/push/safeUrl'
import { sendPushToSubscription } from '@/lib/push/webPush'
import { readBoundedJson } from '../requestBody'
import { isCrossOriginMutation } from '../requestOrigin'

test('push endpoints use supported HTTPS providers and reject malformed destinations', async () => {
  for (const host of ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com', 'wns2-par02p.notify.windows.com']) {
    assert.equal(isPushEndpoint(`https://${host}/subscription-token`), true)
  }
  for (const endpoint of [
    'https://unsupported.example/subscription',
    'http://web.push.apple.com/token',
    'https://web.push.apple.com:444/token',
    'https://web.push.apple.com@unsupported.example/token',
    'https://web.push.apple.com.sibling.example/token',
    'https://web.push.apple.com/token#fragment',
    'https://web.push.apple.com/token\n',
  ]) {
    assert.equal(isPushEndpoint(endpoint), false)
    assert.equal(await sendPushToSubscription({ endpoint, p256dh: '', auth: '' }, {}), 'gone')
  }
})

test('push subscription parsing rejects invalid types and out-of-range dates', () => {
  const endpoint = 'https://web.push.apple.com/token'
  const keys = { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) }
  assert.equal(parsePushSubscription({ endpoint, keys, expirationTime: 0 })?.expires, '1970-01-01T00:00:00.000Z')
  for (const body of [null, { endpoint, keys: null }, { endpoint, keys, expirationTime: 1e20 }, { endpoint, keys: { ...keys, auth: 17 } }]) {
    assert.equal(parsePushSubscription(body), null)
  }
})

test('notification click paths stay on origin after browser URL normalization', () => {
  assert.equal(safeAppPath('/log?day=push'), '/log?day=push')
  assert.equal(safeAppPath('/\t/other.example'), '/home')
  assert.equal(safeAppPath('/\\other.example'), '/home')
})

test('cookie-authenticated writes reject cross-origin browser metadata', () => {
  const url = 'https://grind.test/api/profile/delete-data'
  const post = (headers?: HeadersInit) => new Request(url, { method: 'POST', headers })
  assert.equal(isCrossOriginMutation(post()), false)
  assert.equal(isCrossOriginMutation(post({ origin: 'https://grind.test', 'sec-fetch-site': 'same-origin' })), false)
  assert.equal(isCrossOriginMutation(post({ origin: 'null' })), true)
  assert.equal(isCrossOriginMutation(post({ origin: 'https://other.grind.test' })), true)
  assert.equal(isCrossOriginMutation(post({ 'sec-fetch-site': 'cross-site' })), true)
  assert.equal(isCrossOriginMutation(new Request('http://localhost:3000/api/profile/delete-data', {
    method: 'POST',
    headers: { host: 'grind.test', 'x-forwarded-proto': 'https', origin: 'https://grind.test' },
  })), false)
  assert.equal(isCrossOriginMutation(new Request(url, { headers: { 'sec-fetch-site': 'cross-site' } })), false)
})

test('request body limit counts actual bytes without Content-Length', async () => {
  assert.deepEqual(await readBoundedJson(new Request('https://grind.test', { method: 'POST', body: '{"a":1}' }), 7), { a: 1 })
  const request = new Request('https://grind.test', { method: 'POST', body: '"éé"' })
  assert.equal(request.headers.get('content-length'), null)
  await assert.rejects(readBoundedJson(request, 5), RangeError)
})
