import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isTransientAuthError } from '../authErrors'

describe('isTransientAuthError', () => {
  it('treats network and timeout failures as transient', () => {
    assert.equal(isTransientAuthError({ name: 'AuthRetryableFetchError', message: 'x', status: 0 }), true)
    assert.equal(isTransientAuthError({ name: 'TimeoutError', message: 'Request timed out' }), true)
    assert.equal(isTransientAuthError({ name: 'AbortError', message: 'This operation was aborted' }), true)
    assert.equal(isTransientAuthError({ message: 'fetch failed' }), true)
    assert.equal(isTransientAuthError({ status: 503, message: 'upstream' }), true)
  })

  it('does not treat an invalid or missing session as transient', () => {
    assert.equal(isTransientAuthError({ name: 'AuthSessionMissingError', message: 'Auth session missing!', status: 400 }), false)
    assert.equal(isTransientAuthError({ name: 'AuthApiError', message: 'Invalid Refresh Token', status: 400 }), false)
    assert.equal(isTransientAuthError(null), false)
    assert.equal(isTransientAuthError(undefined), false)
    assert.equal(isTransientAuthError('boom'), false)
  })
})
